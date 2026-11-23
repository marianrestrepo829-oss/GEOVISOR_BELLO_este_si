 var map = L.map('map', {
  zoomControl: false,
  preferCanvas: true
}).setView([6.337, -75.558], 13);

L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 110 }).addTo(map);
var coordinateReadout;
var coordinateControl = L.control({ position: 'bottomleft' });
coordinateControl.onAdd = function () {
  coordinateReadout = L.DomUtil.create('div', 'map-coordinate-control');
  coordinateReadout.setAttribute('role', 'status');
  coordinateReadout.setAttribute('aria-live', 'off');
  coordinateReadout.setAttribute('aria-label', 'Coordenadas geográficas bajo el cursor');
  return coordinateReadout;
};
coordinateControl.addTo(map);
function mostrarCoordenadas(latlng) {
  if (!coordinateReadout || !latlng) return;
  coordinateReadout.textContent = 'Lat ' + latlng.lat.toFixed(5) + ' · Lon ' + latlng.lng.toFixed(5);
}
mostrarCoordenadas(map.getCenter());
map.on('mousemove', function (event) { mostrarCoordenadas(event.latlng); });

var streetViewButton = document.getElementById('streetViewBtn');
var streetViewPanel = document.getElementById('streetViewPanel');
var streetViewFrame = document.getElementById('streetViewFrame');
var streetViewLocation = document.getElementById('streetViewLocation');

function cargarPanoramaStreetView(latlng) {
  if (!latlng || !streetViewFrame) return;
  var coordinates = latlng.lat.toFixed(6) + ',' + latlng.lng.toFixed(6);
  var parameters = 'layer=' + encodeURIComponent('c') +
    '&cbll=' + encodeURIComponent(coordinates) +
    '&cbp=' + encodeURIComponent('12,0,0,0,0') +
    '&output=' + encodeURIComponent('svembed');
  streetViewFrame.src = 'https://maps.google.com/maps?' + parameters;
  if (streetViewLocation) {
    streetViewLocation.textContent = 'Panorama solicitado para ' + coordinates +
      '. La disponibilidad depende de Google y de que exista cobertura en el punto.';
  }
}

function cerrarStreetView() {
  if (streetViewPanel) streetViewPanel.hidden = true;
  if (streetViewButton) streetViewButton.setAttribute('aria-expanded', 'false');
  if (streetViewFrame) streetViewFrame.src = 'about:blank';
}

if (streetViewButton && streetViewPanel) {
  streetViewButton.addEventListener('click', function () {
    streetViewPanel.hidden = false;
    streetViewButton.setAttribute('aria-expanded', 'true');
    cargarPanoramaStreetView(map.getCenter());
  });
  document.getElementById('reloadStreetViewBtn').addEventListener('click', function () {
    cargarPanoramaStreetView(map.getCenter());
  });
  document.getElementById('closeStreetViewBtn').addEventListener('click', cerrarStreetView);
  streetViewFrame.addEventListener('error', function () {
    if (streetViewLocation) streetViewLocation.textContent =
      'No fue posible cargar el iframe. La URL clásica puede estar bloqueada o no disponible.';
  });
  map.on('click', function (event) {
    if (!streetViewPanel.hidden) cargarPanoramaStreetView(event.latlng);
  });
}

var drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
var mapLegend = document.getElementById('mapLegend');
var mapLegendContent = document.getElementById('mapLegendContent');
var polygonDrawHandler = null;
var measurementDrawHandler = null;
var measurementMode = null;
var measurementCompleted = false;
var measureDistanceBtn = document.getElementById('measureDistanceBtn');
var measureAreaBtn = document.getElementById('measureAreaBtn');
var measureDistanceUnit = document.getElementById('measureDistanceUnit');
var measureAreaUnit = document.getElementById('measureAreaUnit');
var measureMessage = document.getElementById('measureMessage');
function actualizarBotonDibujo(activo) {
  if (!drawPolygonBtn) return;
  drawPolygonBtn.textContent = activo ? 'Cancelar polígono' : 'Crear polígono';
  drawPolygonBtn.setAttribute('aria-pressed', activo ? 'true' : 'false');
  drawPolygonBtn.title = activo ? 'Cancela el dibujo actual' : 'Dibuja un polígono sobre el mapa';
  drawPolygonBtn.classList.toggle('drawing', activo);
}
map.on(L.Draw.Event.CREATED, function (event) {
  var measurementLabel = null;
  if (measurementMode) {
    measurementCompleted = true;
    event.layer._measurementType = measurementMode;
    var color = measurementMode === 'distance' ? '#168b91' : '#d76a3d';
    event.layer.setStyle({ color: color, weight: 3, fillColor: color, fillOpacity: .18 });
    var result = calcularMedicion(event.layer, measurementMode);
    measurementLabel = result.label;
    event.layer.bindTooltip(measurementLabel, { permanent: true, direction: 'center', className: 'measurement-tooltip' });
    if (measureMessage) measureMessage.textContent = result.message;
  }
  drawnItems.addLayer(event.layer);
  if (measurementLabel) event.layer.openTooltip();
  var drawingSummary = event.layer.toGeoJSON();
  registrarOperacion({
    tool: measurementMode ? 'Medición manual' : 'Dibujo de geometría',
    procedure: measurementLabel ? 'Se midió una geometría trazada manualmente sobre el mapa.' : 'Se creó una geometría manual sobre el mapa.',
    parameters: measurementMode ? { tipo: measurementMode } : {},
    result: {
      metrics: measurementLabel ? { medicion: measurementLabel } : { tipoGeometria: drawingSummary.geometry.type },
      description: 'Geometría agregada al conjunto de dibujos del mapa.'
    },
    interpretation: 'El dibujo representa una geometría de trabajo creada por el usuario; no está vinculado a una capa catastral ni acredita límites oficiales.'
  });
  actualizarBotonBorrar();
  actualizarLeyendaMapa();
});
map.on(L.Draw.Event.DELETED, function (event) {
  var deletedCount = 0;
  event.layers.eachLayer(function () { deletedCount += 1; });
  if (deletedCount) registrarOperacion({
    tool: 'Eliminación de dibujos',
    procedure: 'Se eliminaron geometrías dibujadas o mediciones del mapa.',
    processedCount: deletedCount,
    result: { metrics: { geometríasEliminadas: deletedCount }, description: 'Dibujos retirados de la vista actual.' },
    interpretation: 'La eliminación afecta los dibujos de esta sesión; no modifica las capas geográficas de origen.'
  });
  actualizarBotonBorrar();
  actualizarLeyendaMapa();
});
map.on(L.Draw.Event.EDITED, function (event) {
  var editedCount = 0;
  event.layers.eachLayer(function (layer) {
    editedCount += 1;
    if (layer._measurementType) {
      var result = calcularMedicion(layer, layer._measurementType);
      if (layer.getTooltip()) layer.setTooltipContent(result.label);
      if (measureMessage) measureMessage.textContent = result.message;
    }
  });
  if (editedCount) registrarOperacion({
    tool: 'Edición de geometrías dibujadas',
    procedure: 'Se modificó la geometría de dibujos o mediciones existentes en el mapa.',
    processedCount: editedCount,
    result: { metrics: { geometríasModificadas: editedCount } },
    interpretation: 'La edición se limita a dibujos de esta sesión y no actualiza la geometría de una capa de origen.'
  });
  actualizarLeyendaMapa();
});
map.on(L.Draw.Event.DRAWSTART, function (event) {
  if (event.layerType === 'polygon' && !measurementMode) actualizarBotonDibujo(true);
});
map.on(L.Draw.Event.DRAWSTOP, function () {
  actualizarBotonDibujo(false);
  polygonDrawHandler = null;
  if (measurementMode && !measurementCompleted && measureMessage) measureMessage.textContent = 'Medición cancelada.';
  measurementDrawHandler = null;
  measurementMode = null;
  measurementCompleted = false;
  [measureDistanceBtn, measureAreaBtn].forEach(function (button) {
    if (button) {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    }
  });
});
if (L.drawLocal && L.drawLocal.draw && L.drawLocal.draw.handlers) {
  var polygonTooltip = L.drawLocal.draw.handlers.polygon.tooltip;
  var polylineTooltip = L.drawLocal.draw.handlers.polyline.tooltip;
  polygonTooltip.start = 'Haz clic para comenzar a dibujar el contorno.';
  polygonTooltip.cont = 'Haz clic para añadir un punto.';
  polygonTooltip.end = 'Haz clic en el primer punto o haz doble clic para terminar.';
  polylineTooltip.start = 'Haz clic para comenzar a medir la distancia.';
  polylineTooltip.cont = 'Haz clic para continuar; haz doble clic para terminar.';
  polylineTooltip.end = 'Haz doble clic para terminar la medición.';
}

var drawControl = new L.Control.Draw({
  edit: {
    featureGroup: drawnItems,
    remove: true
  },
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: '#8adbff',
        weight: 2,
        fillColor: '#4aa6ff',
        fillOpacity: 0.2
      }
    },
    polyline: {
      shapeOptions: {
        color: '#8adbff',
        weight: 3
      }
    },
    rectangle: false,
    circle: false,
    marker: false,
    circlemarker: false,
    polyline: {
      showLength: true,
      metric: true,
      feet: false,
      shapeOptions: {
        color: '#8adbff',
        weight: 3
      }
    }
  }
});
map.addControl(drawControl);

var drawPolygonBtn = document.getElementById('drawPolygonBtn');
var clearPolygonsBtn = document.getElementById('clearPolygonsBtn');
function actualizarBotonBorrar() {
  if (clearPolygonsBtn) clearPolygonsBtn.disabled = drawnItems.getLayers().length === 0;
}

function formatearDistancia(metros) {
  var number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
  var unidad = measureDistanceUnit ? measureDistanceUnit.value : 'm';
  var factores = { m: 1, km: 1000, mi: 1609.344 };
  return number.format(metros / factores[unidad]) + ' ' + unidad;
}

function formatearArea(metrosCuadrados) {
  var number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
  var unidad = measureAreaUnit ? measureAreaUnit.value : 'm2';
  var factores = { m2: 1, ha: 10000, km2: 1000000, ac: 4046.8564224 };
  var etiquetas = { m2: 'm²', ha: 'ha', km2: 'km²', ac: 'ac' };
  return number.format(metrosCuadrados / factores[unidad]) + ' ' + etiquetas[unidad];
}

function calcularMedicion(layer, tipo) {
  var latlngs = layer.getLatLngs();
  if (tipo === 'distance') {
    var total = 0;
    for (var i = 1; i < latlngs.length; i += 1) total += latlngs[i - 1].distanceTo(latlngs[i]);
    var distancia = formatearDistancia(total);
    return { label: distancia, message: 'Distancia medida: ' + distancia + '.' };
  }
  var anilloExterior = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  var area = L.GeometryUtil.geodesicArea(anilloExterior);
  var areaFormateada = formatearArea(area);
  return { label: areaFormateada, message: 'Área medida: ' + areaFormateada + '.' };
}

function actualizarUnidadesMedicion() {
  drawnItems.eachLayer(function (layer) {
    if (!layer._measurementType) return;
    var result = calcularMedicion(layer, layer._measurementType);
    if (layer.getTooltip()) layer.setTooltipContent(result.label);
  });
  if (measureMessage) {
    var mediciones = drawnItems.getLayers().filter(function (layer) { return !!layer._measurementType; });
    var ultima = mediciones[mediciones.length - 1];
    if (ultima) measureMessage.textContent = calcularMedicion(ultima, ultima._measurementType).message;
  }
}
if (measureDistanceUnit) measureDistanceUnit.addEventListener('change', actualizarUnidadesMedicion);
if (measureAreaUnit) measureAreaUnit.addEventListener('change', actualizarUnidadesMedicion);

function iniciarMedicion(tipo, boton) {
  if (measurementDrawHandler) {
    if (measurementMode === tipo) {
      measurementDrawHandler.disable();
      return;
    }
    measurementDrawHandler.disable();
  }
  if (polygonDrawHandler) polygonDrawHandler.disable();
  measurementMode = tipo;
  measurementCompleted = false;
  var options = tipo === 'distance'
    ? drawControl.options.draw.polyline
    : drawControl.options.draw.polygon;
  measurementDrawHandler = tipo === 'distance'
    ? new L.Draw.Polyline(map, Object.assign({}, options, { showLength: true, metric: true }))
    : new L.Draw.Polygon(map, Object.assign({}, options, { showArea: true }));
  if (measureDistanceBtn) measureDistanceBtn.classList.toggle('active', tipo === 'distance');
  if (measureAreaBtn) measureAreaBtn.classList.toggle('active', tipo === 'area');
  if (boton) boton.setAttribute('aria-pressed', 'true');
  if (measureMessage) measureMessage.textContent = tipo === 'distance'
    ? 'Traza la ruta sobre el mapa; termina con doble clic.'
    : 'Marca el contorno del área; termina con doble clic.';
  measurementDrawHandler.enable();
}

if (measureDistanceBtn) measureDistanceBtn.addEventListener('click', function () { iniciarMedicion('distance', this); });
if (measureAreaBtn) measureAreaBtn.addEventListener('click', function () { iniciarMedicion('area', this); });

function agregarFilaLeyenda(contenedor, nombre, colorLinea, colorRelleno, geometria) {
  var row = document.createElement('div');
  row.className = 'map-legend-row';
  var symbol = document.createElement('span');
  symbol.className = 'map-legend-symbol';
  if (/^(Multi)?LineString$/.test(geometria || '') || (!colorRelleno && !/^(Multi)?Point$/.test(geometria || ''))) symbol.classList.add('is-line');
  if (/^(Multi)?Point$/.test(geometria || '')) symbol.classList.add('is-point');
  symbol.style.setProperty('--legend-stroke', colorLinea || colorRelleno || '#52758e');
  symbol.style.setProperty('--legend-fill', colorRelleno || colorLinea || '#52758e');
  var label = document.createElement('span');
  label.textContent = nombre;
  row.append(symbol, label);
  contenedor.appendChild(row);
}

function actualizarLeyendaMapa() {
  if (!mapLegend || !mapLegendContent) return;
  mapLegendContent.replaceChildren();
  var capasActivas = Object.keys(capas).filter(function (name) { return map.hasLayer(capas[name]); });
  capasActivas.forEach(function (name) {
    var layer = capas[name];
    var section = document.createElement('section');
    section.className = 'map-legend-layer';
    var heading = document.createElement('h3');
    heading.textContent = name;
    section.appendChild(heading);
    if (layer._classification) {
      var classifiedFeature = (layer._attributeFeatures || []).find(function (item) { return item.geometry; });
      var classifiedGeometry = classifiedFeature && classifiedFeature.geometry.type;
      layer._classification.groups.forEach(function (group, index) {
        agregarFilaLeyenda(section, group.label + ' (' + group.count.toLocaleString('es-CO') + ')', layer._classification.colors[index], layer._classification.colors[index], classifiedGeometry);
      });
      if (layer._classification.missingCount > 0) {
        agregarFilaLeyenda(section, 'Sin dato (' + layer._classification.missingCount.toLocaleString('es-CO') + ')', '#75869a', '#cbd5df', classifiedGeometry);
      }
    } else {
      var style = layer._styleFunction ? layer._styleFunction() : {};
      var feature = (layer._attributeFeatures || []).find(function (item) { return item.geometry; });
      var geometry = feature && feature.geometry.type;
      agregarFilaLeyenda(section, 'Elementos', style.color, style.fillColor, geometry);
    }
    mapLegendContent.appendChild(section);
  });
  if (drawnItems.getLayers().length) {
    var drawingSection = document.createElement('section');
    drawingSection.className = 'map-legend-layer';
    var drawingHeading = document.createElement('h3');
    drawingHeading.textContent = 'Dibujos y mediciones';
    drawingSection.appendChild(drawingHeading);
    var manualLayers = drawnItems.getLayers();
    if (manualLayers.some(function (item) { return !item._measurementType && item instanceof L.Polygon; })) agregarFilaLeyenda(drawingSection, 'Polígono dibujado', '#8adbff', '#4aa6ff', 'Polygon');
    if (manualLayers.some(function (item) { return !item._measurementType && !(item instanceof L.Polygon); })) agregarFilaLeyenda(drawingSection, 'Línea dibujada', '#8adbff', null, 'LineString');
    if (manualLayers.some(function (item) { return item._measurementType === 'distance'; })) agregarFilaLeyenda(drawingSection, 'Distancia medida', '#168b91', null, 'LineString');
    if (manualLayers.some(function (item) { return item._measurementType === 'area'; })) agregarFilaLeyenda(drawingSection, 'Área medida', '#d76a3d', '#d76a3d', 'Polygon');
    mapLegendContent.appendChild(drawingSection);
  }
  if (capasActivas.length === 0 && drawnItems.getLayers().length === 0) {
    var emptyMessage = document.createElement('p');
    emptyMessage.className = 'map-legend-empty';
    emptyMessage.textContent = 'Activa una capa o dibuja un polígono para ver aquí sus símbolos y colores.';
    mapLegendContent.appendChild(emptyMessage);
  }
  mapLegend.hidden = false;
}
if (drawPolygonBtn) {
  drawPolygonBtn.addEventListener('click', function () {
    if (polygonDrawHandler) {
      polygonDrawHandler.disable();
      return;
    }
    if (measurementDrawHandler) measurementDrawHandler.disable();
    polygonDrawHandler = new L.Draw.Polygon(map, drawControl.options.draw.polygon);
    polygonDrawHandler.enable();
  });
}
if (clearPolygonsBtn) {
  clearPolygonsBtn.addEventListener('click', function () {
    if (polygonDrawHandler) polygonDrawHandler.disable();
    if (measurementDrawHandler) measurementDrawHandler.disable();
    var clearedCount = drawnItems.getLayers().length;
    if (clearedCount) registrarOperacion({
      tool: 'Eliminación de dibujos',
      procedure: 'Se limpiaron todos los dibujos y mediciones del mapa mediante el control de borrado.',
      processedCount: clearedCount,
      result: { metrics: { geometríasEliminadas: clearedCount } },
      interpretation: 'La eliminación afecta los dibujos de esta sesión; no modifica las capas geográficas de origen.'
    });
    drawnItems.clearLayers();
    if (measureMessage) measureMessage.textContent = 'Elige una medición para comenzar.';
    actualizarBotonBorrar();
    actualizarLeyendaMapa();
  });
}

var OpenStreetMap_France = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap France | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
OpenStreetMap_France.addTo(map);

var Esri_WorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

var Esri_WorldStreetMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
});

var basemaps = {
  'Mapa de calles': OpenStreetMap_France,
  'Imagen satelital': Esri_WorldImagery,
  'Mapa vial': Esri_WorldStreetMap
};

var capas = {};
var limitesRasters = L.latLngBounds();
var basemapList = document.getElementById('basemapList');

if (basemapList) {
  Object.keys(basemaps).forEach(function (basemapName, index) {
    var label = document.createElement('label');
    label.className = 'basemap-option';

    var input = document.createElement('input');
    input.type = 'radio';
    input.name = 'basemap';
    input.value = basemapName;
    input.checked = map.hasLayer(basemaps[basemapName]);
    input.setAttribute('aria-label', basemapName);
    input.addEventListener('change', function () {
      if (!input.checked) return;

      Object.keys(basemaps).forEach(function (name) {
        if (map.hasLayer(basemaps[name])) {
          map.removeLayer(basemaps[name]);
        }
      });
      basemaps[basemapName].addTo(map);
    });

    var text = document.createElement('span');
    text.textContent = basemapName;

    label.appendChild(input);
    label.appendChild(text);
    basemapList.appendChild(label);
  });
}

var placeSearchForm = document.getElementById('placeSearchForm');
var placeSearchInput = document.getElementById('placeSearchInput');
var placeSearchStatus = document.getElementById('placeSearchStatus');
var placeSearchResults = document.getElementById('placeSearchResults');
var geocoderEndpointInput = document.getElementById('geocoderEndpoint');
var saveGeocoderEndpoint = document.getElementById('saveGeocoderEndpoint');
var defaultGeocoderEndpoint = 'https://nominatim.openstreetmap.org/search';
var geocoderEndpointKey = 'geovisorBello.geocoderEndpoint';
var geocoderCache = new Map();
var lastGeocoderRequestAt = 0;
var lastAddressSearchWasApproximate = false;
var searchResultMarker = null;
try {
  if (geocoderEndpointInput) geocoderEndpointInput.value = localStorage.getItem(geocoderEndpointKey) || defaultGeocoderEndpoint;
} catch (storageError) {
  if (geocoderEndpointInput) geocoderEndpointInput.value = defaultGeocoderEndpoint;
}

function mostrarEstadoBusqueda(mensaje, esError) {
  if (!placeSearchStatus) return;
  placeSearchStatus.textContent = mensaje || '';
  placeSearchStatus.classList.toggle('error', Boolean(esError));
}

function obtenerProveedorGeocodificacion() {
  var endpoint = geocoderEndpointInput && geocoderEndpointInput.value.trim();
  return endpoint || defaultGeocoderEndpoint;
}

function deduplicarResultadosGeocodificador(results) {
  var seen = new Set();
  return results.filter(function (result) {
    var label = normalizarTextoBusqueda(result && result.display_name);
    var key = label || (result && result.osm_type && result.osm_id
      ? result.osm_type + ':' + result.osm_id
      : result && Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon))
        ? Number(result.lat).toFixed(6) + ',' + Number(result.lon).toFixed(6)
        : '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function consultarGeocodificador(consulta) {
  var endpoint = obtenerProveedorGeocodificacion();
  var cacheKey = endpoint + '|' + consulta.toLocaleLowerCase('es');
  if (geocoderCache.has(cacheKey)) {
    var cached = geocoderCache.get(cacheKey);
    lastAddressSearchWasApproximate = cached.approximate;
    return cached.results;
  }
  var addressMatch = /(?:^|\s)(?:calle|cl|carrera|cra|cr|carr|diagonal|diag|dg|transversal|transv|tv|avenida|av|autopista|circular)\.?(?=\s|$)/i.test(consulta);
  var isAddress = addressMatch && /\d/.test(consulta);
  var normalizedAddress = consulta.replace(/[‐‑‒–—−]/g, '-')
    .replace(/\b(?:n(?:[º°]|o)|no\.?|numero|número)\s*/gi, '# ')
    .replace(/\s*#\s*/g, ' # ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  var street = normalizedAddress.replace(/\s*,?\s*bello(?:\s*,?\s*antioquia)?(?:\s*,?\s*colombia)?\s*$/i, '').trim();
  var streetOnly = street.replace(/\s*#.*$/, '').trim();
  var structuredStreet = street.replace(/\s*#\s*/, ' ').replace(/\s+/g, ' ').trim();
  var query = /bello/i.test(normalizedAddress) ? normalizedAddress : normalizedAddress + ', Bello, Antioquia, Colombia';

  async function buscar(parametros, esDireccion) {
    var espera = 1100 - (Date.now() - lastGeocoderRequestAt);
    if (espera > 0) await new Promise(function (resolve) { window.setTimeout(resolve, espera); });
    lastGeocoderRequestAt = Date.now();
    var url = new URL(endpoint);
    Object.keys(parametros).forEach(function (key) { url.searchParams.set(key, parametros[key]); });
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'co');
    url.searchParams.set('accept-language', 'es');
    url.searchParams.set('viewbox', '-75.68,6.43,-75.47,6.25');
    url.searchParams.set('bounded', esDireccion ? '0' : '1');
    var response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('El servicio respondió con el estado ' + response.status + '.');
    return response.json();
  }

  var results = isAddress
    ? await buscar({ street: structuredStreet, city: 'Bello', state: 'Antioquia', country: 'Colombia' }, true)
    : await buscar({ q: query });
  var approximate = false;
  if (isAddress && !results.length) results = await buscar({ q: query }, true);
  if (isAddress && !results.length && streetOnly && streetOnly !== street) {
    results = await buscar({ q: streetOnly + ', Bello, Antioquia, Colombia' }, true);
    approximate = Boolean(results.length);
  }
  results = deduplicarResultadosGeocodificador(results);
  lastAddressSearchWasApproximate = approximate;
  geocoderCache.set(cacheKey, { results: results, approximate: approximate });
  return results;
}

function enfocarResultadoBusqueda(result) {
  var lat = Number(result.lat);
  var lon = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (searchResultMarker) map.removeLayer(searchResultMarker);
  searchResultMarker = L.circleMarker([lat, lon], {
    radius: 7,
    color: '#fff',
    weight: 2,
    fillColor: '#d76a3d',
    fillOpacity: 1
  }).addTo(map);
  var bounds = result.boundingbox && result.boundingbox.map(Number);
  if (bounds && bounds.length === 4 && bounds.every(Number.isFinite)) {
    map.flyToBounds([[bounds[0], bounds[2]], [bounds[1], bounds[3]]], { padding: [28, 28], maxZoom: 16 });
  } else {
    map.flyTo([lat, lon], Math.max(map.getZoom(), 16));
  }
  var resultPopup = document.createElement('span');
  resultPopup.textContent = result.display_name || 'Lugar encontrado';
  searchResultMarker.bindPopup(resultPopup).openPopup();
}

if (placeSearchForm) placeSearchForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  var query = placeSearchInput && placeSearchInput.value.trim();
  if (!query || query.length < 3) {
    mostrarEstadoBusqueda('Escribe al menos tres caracteres para buscar.', true);
    return;
  }
  var button = placeSearchForm.querySelector('[type="submit"]');
  if (button) button.disabled = true;
  if (placeSearchResults) placeSearchResults.replaceChildren();
  mostrarEstadoBusqueda('Buscando dirección o lugar en Bello…');
  try {
    var results = await consultarGeocodificador(query);
    if (!results.length) {
      mostrarEstadoBusqueda('No encontramos resultados en Bello. Prueba solo con el nombre de la vía o del barrio; OpenStreetMap no tiene registradas todas las direcciones.');
      return;
    }
    mostrarEstadoBusqueda(lastAddressSearchWasApproximate
      ? 'No encontramos el número exacto; mostramos resultados de la vía. Elige uno para centrar el mapa.'
      : results.length === 1 ? 'Encontramos un lugar. Selecciónalo para centrar el mapa.' : 'Encontramos ' + results.length + ' lugares. Elige uno para centrar el mapa.');
    results.forEach(function (result) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'place-search-result';
      option.textContent = result.display_name || 'Lugar encontrado';
      option.addEventListener('click', function () {
        enfocarResultadoBusqueda(result);
        mostrarEstadoBusqueda('Mapa centrado en el lugar seleccionado.');
      });
      placeSearchResults.appendChild(option);
    });
  } catch (error) {
    console.error('No se pudo completar la búsqueda geográfica:', error);
    mostrarEstadoBusqueda('No se pudo consultar el servicio. Revisa tu conexión o el proveedor configurado.', true);
  } finally {
    if (button) button.disabled = false;
  }
});

if (saveGeocoderEndpoint) saveGeocoderEndpoint.addEventListener('click', function () {
  var endpoint = geocoderEndpointInput && geocoderEndpointInput.value.trim();
  try {
    var parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') throw new Error('Usa una dirección HTTPS para el proveedor.');
    if (!/\/search\/?$/.test(parsed.pathname)) throw new Error('Usa la ruta de búsqueda del servicio, por ejemplo /search.');
    localStorage.setItem(geocoderEndpointKey, parsed.toString());
    geocoderCache.clear();
    mostrarEstadoBusqueda('Proveedor de búsqueda guardado.');
  } catch (error) {
    mostrarEstadoBusqueda(error.message || 'Escribe una dirección válida para el servicio.', true);
  }
});

var layerList = document.getElementById('layerList');
var layerSearch = document.getElementById('layerSearch');

function normalizarTextoBusqueda(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function actualizarResumenCapas(total, filtradas) {
  var layerCount = document.getElementById('layerCount');
  var activeLayerCount = document.getElementById('activeLayerCount');
  var cantidadActivas = Object.keys(capas).filter(function (name) { return map.hasLayer(capas[name]); }).length;
  if (layerCount) {
    layerCount.textContent = filtradas === total
      ? (total === 1 ? '1 capa' : total + ' capas')
      : filtradas + ' de ' + total + ' capas';
  }
  if (activeLayerCount) activeLayerCount.textContent = cantidadActivas === 1 ? '1 activa' : cantidadActivas + ' activas';
}

function prepararRenderizadoCapa(layer) {
  if (layer._mapFeaturesReady) return Promise.resolve(layer);
  if (layer._renderPromise) return layer._renderPromise;

  var features = layer._attributeFeatures || [];
  var cursor = 0;
  var batchSize = 120;
  layer.addTo(map);
  layer._renderPromise = new Promise(function (resolve, reject) {
    function dibujarLote() {
      try {
        var lote = features.slice(cursor, cursor + batchSize);
        if (lote.length) {
          layer.addLayer(L.geoJSON({ type: 'FeatureCollection', features: lote }, {
            onEachFeature: mostrarAtributos,
            style: function (feature) {
              return ajustarEstiloOpacidad(layer, layer._styleFunction(feature) || {});
            },
            smoothFactor: 1.5
          }));
          cursor += lote.length;
          (window.requestAnimationFrame || function (callback) { window.setTimeout(callback, 0); })(dibujarLote);
          return;
        }
        layer._mapFeaturesReady = true;
        layer._renderPromise = null;
        resolve(layer);
      } catch (error) {
        map.removeLayer(layer);
        layer.clearLayers();
        layer._renderPromise = null;
        reject(error);
      }
    }
    dibujarLote();
  });
  return layer._renderPromise;
}

function actualizarListaCapas() {
  if (!layerList) return;

  layerList.innerHTML = '';
  var nombresCapas = Object.keys(capas);
  var consulta = normalizarTextoBusqueda(layerSearch && layerSearch.value);
  var nombresFiltrados = nombresCapas.filter(function (name) { return normalizarTextoBusqueda(name).indexOf(consulta) !== -1; });
  actualizarResumenCapas(nombresCapas.length, nombresFiltrados.length);
  actualizarLeyendaMapa();

  if (!nombresFiltrados.length) {
    var emptyState = document.createElement('p');
    emptyState.className = 'layer-empty';
    emptyState.textContent = consulta ? 'No hay capas que coincidan con esa búsqueda.' : 'Las capas aparecerán aquí cuando estén disponibles.';
    layerList.appendChild(emptyState);
    return;
  }

  nombresFiltrados.forEach(function (layerName) {
    var item = document.createElement('div');
    item.className = 'layer-item';

    var label = document.createElement('div');
    label.className = 'layer-label';

    var dot = document.createElement('span');
    dot.className = 'layer-dot';

    var text = document.createElement('span');
    text.textContent = layerName;

    label.appendChild(dot);
    label.appendChild(text);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'layer-toggle';
    toggle.setAttribute('aria-label', 'Mostrar u ocultar ' + layerName);

    var layer = capas[layerName];
    if (layer && !Number.isFinite(layer._opacity)) layer._opacity = 1;
    if (layer && map.hasLayer(layer)) {
      toggle.classList.add('active');
    }

    toggle.addEventListener('click', function () {
      if (!layer || typeof layer.addTo !== 'function') return;
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        toggle.classList.remove('active');
        actualizarResumenCapas(nombresCapas.length, nombresFiltrados.length);
        actualizarLeyendaMapa();
        return;
      }
      if (window.location.protocol === 'file:') {
        alert('Para cargar las capas, inicia el geovisor con Iniciar_Geovisor.bat. No abras index.html directamente como archivo.');
        return;
      }
      toggle.disabled = true;
      toggle.classList.add('loading');
      toggle.title = 'Cargando capa…';
      asegurarCargaCapa(layer).then(function () {
        return prepararRenderizadoCapa(layer);
      }).then(function () {
        actualizarListaCapas();
      }).catch(function (error) {
        console.error('No se pudo cargar la capa ' + layerName + ':', error);
        alert('No se pudo cargar la capa «' + layerName + '». Comprueba que el ZIP de data/ esté incluido en la publicación de GitHub Pages y que haya conexión a Internet.');
      }).finally(function () {
        toggle.disabled = false;
        toggle.classList.remove('loading');
        toggle.title = '';
      });
    });

    var zoomButton = document.createElement('button');
    zoomButton.type = 'button';
    zoomButton.className = 'layer-zoom-button';
    zoomButton.setAttribute('aria-label', 'Acercar el mapa a ' + layerName);
    zoomButton.title = 'Mostrar esta capa y ajustar el mapa a su extensión';
    zoomButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.2"></circle><path d="m12.4 12.4 4.1 4.1M8.5 5.7v5.6M5.7 8.5h5.6"></path></svg>';
    zoomButton.addEventListener('click', function () {
      zoomButton.disabled = true;
      zoomButton.title = 'Cargando la capa y ajustando la vista…';
      asegurarCargaCapa(layer).then(function () {
        return prepararRenderizadoCapa(layer);
      }).then(function () {
        var bounds = layer.getBounds();
        if (!bounds.isValid()) throw new Error('Esta capa no tiene una extensión geográfica válida.');
        map.fitBounds(bounds.pad(0.08), { maxZoom: 16 });
        actualizarListaCapas();
      }).catch(function (error) {
        console.error('No se pudo ajustar la vista a ' + layerName + ':', error);
        alert(error.message || 'No se pudo mostrar esta capa en el mapa.');
      }).finally(function () {
        zoomButton.disabled = false;
        zoomButton.title = 'Mostrar esta capa y ajustar el mapa a su extensión';
      });
    });

    var tableButton = document.createElement('button');
    tableButton.type = 'button';
    tableButton.className = 'attribute-table-button';
    tableButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"></rect><path d="M2.5 8h15M7.5 8v8.5M12.5 8v8.5"></path></svg>';
    tableButton.title = 'Abrir tabla de atributos';
    tableButton.setAttribute('aria-label', 'Abrir tabla de atributos de ' + layerName);
    tableButton.addEventListener('click', function () {
      abrirTablaAtributos(layerName, layer);
    });

    var downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'layer-download-button';
    downloadButton.setAttribute('aria-label', 'Descargar shapefile de ' + layerName);
    downloadButton.title = 'Descargar capa como Shapefile (.shp dentro de ZIP)';
    downloadButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 2.8v9.1m0 0 3.4-3.4M10 11.9 6.6 8.5M3.5 13.2v3.3h13v-3.3"></path></svg>';
    downloadButton.addEventListener('click', function () {
      if (!layer || !window.shpwrite || typeof window.shpwrite.zip !== 'function') {
        alert('No está disponible el generador de archivos Shapefile. Comprueba tu conexión y vuelve a cargar el visor.');
        return;
      }
      downloadButton.disabled = true;
      downloadButton.title = 'Preparando Shapefile…';
      asegurarCargaCapa(layer).then(function () {
        var features = (layer._attributeFeatures || []).filter(function (feature) {
          return feature && feature.geometry && feature.geometry.coordinates;
        }).map(function (feature) {
          var properties = {};
          Object.keys(feature.properties || {}).forEach(function (key) {
            if (key.charAt(0) !== '_') properties[key] = feature.properties[key];
          });
          return Object.assign({}, feature, { properties: properties });
        });
        if (!features.length) throw new Error('La capa no contiene geometrías para exportar.');
        var collection = { type: 'FeatureCollection', features: features };
        var baseName = nombreArchivoShapefile(layerName);
        return Promise.resolve(window.shpwrite.zip(collection, {
          folder: baseName,
          filename: baseName,
          outputType: 'blob'
        })).then(function (archivo) {
          var blob = archivo instanceof Blob ? archivo : new Blob([archivo], { type: 'application/zip' });
          var urlTemporal = URL.createObjectURL(blob);
          var enlace = document.createElement('a');
          enlace.href = urlTemporal;
          enlace.download = baseName + '.zip';
          document.body.appendChild(enlace);
          enlace.click();
          enlace.remove();
          setTimeout(function () { URL.revokeObjectURL(urlTemporal); }, 1000);
        });
      }).catch(function (error) {
        console.error('No se pudo exportar la capa ' + layerName + ':', error);
        alert(error.message || 'No se pudo generar el Shapefile de esta capa.');
      }).finally(function () {
        downloadButton.disabled = false;
        downloadButton.title = 'Descargar capa como Shapefile (.shp dentro de ZIP)';
      });
    });

    var opacityControl = document.createElement('label');
    opacityControl.className = 'layer-opacity';
    var opacityCaption = document.createElement('span');
    opacityCaption.textContent = 'Opacidad';
    var opacityValue = document.createElement('span');
    opacityValue.textContent = Math.round((layer._opacity === undefined ? 1 : layer._opacity) * 100) + '%';
    var opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '100';
    opacityInput.value = String(Math.round((layer._opacity === undefined ? 1 : layer._opacity) * 100));
    opacityInput.setAttribute('aria-label', 'Opacidad de ' + layerName);
    opacityInput.addEventListener('input', function () {
      layer._opacity = Number(opacityInput.value) / 100;
      opacityValue.textContent = opacityInput.value + '%';
      aplicarOpacidadCapa(layer);
    });
    opacityControl.appendChild(opacityCaption);
    opacityControl.appendChild(opacityInput);
    opacityControl.appendChild(opacityValue);

    item.appendChild(label);
    item.appendChild(zoomButton);
    item.appendChild(downloadButton);
    item.appendChild(tableButton);
    item.appendChild(toggle);
    item.appendChild(opacityControl);
    layerList.appendChild(item);
  });
}

if (layerSearch) layerSearch.addEventListener('input', actualizarListaCapas);

function abrirTablaAtributos(nombre, layer) {
  if (window.location.protocol === 'file:') {
    alert('Para leer los archivos de atributos, inicia el geovisor con Iniciar_Geovisor.bat. No abras index.html directamente como archivo.');
    return;
  }
  var modal = document.getElementById('attributeTableModal');
  var title = document.getElementById('attributeTableTitle');
  var content = document.getElementById('attributeTableContent');
  if (!modal || !title || !content) return;

  title.textContent = 'Atributos: ' + nombre;
  content.textContent = 'Cargando atributos…';
  modal.hidden = false;
  document.getElementById('closeAttributeTable').focus();
  asegurarCargaCapa(layer).then(function () {
    if (!modal.hidden) renderizarTablaAtributos(nombre, layer, content);
  }).catch(function (error) {
    console.error('No se pudo cargar la tabla de ' + nombre + ':', error);
    if (!modal.hidden) content.textContent = 'No se pudieron cargar los atributos. Revisa que el archivo ZIP esté disponible.';
  });
}

function renderizarTablaAtributos(nombre, layer, content) {
  content.replaceChildren();
  var features = layer._attributeFeatures || [];
  if (!features.length) {
    content.textContent = 'Esta capa no tiene registros de atributos disponibles.';
    return;
  }

  var fields = [];
  features.forEach(function (feature) {
    Object.keys(feature.properties || {}).forEach(function (field) {
      if (field.charAt(0) !== '_' && fields.indexOf(field) === -1) fields.push(field);
    });
  });
  if (!fields.length) {
    content.textContent = 'Los elementos de esta capa no contienen atributos.';
    return;
  }

  var pageSize = 100;
  var page = 0;
  var search = document.createElement('input');
  search.type = 'search';
  search.className = 'attribute-table-search';
  search.placeholder = 'Filtrar registros…';
  search.setAttribute('aria-label', 'Filtrar registros de ' + nombre + ' por cualquier atributo');
  var table = document.createElement('table');
  table.className = 'attribute-table';
  var thead = table.createTHead();
  var headerRow = thead.insertRow();
  fields.forEach(function (field) {
    var th = document.createElement('th');
    th.scope = 'col';
    th.textContent = field;
    headerRow.appendChild(th);
  });
  var tbody = table.createTBody();
  var footer = document.createElement('div');
  footer.className = 'attribute-table-footer';
  var status = document.createElement('span');
  var previous = document.createElement('button');
  previous.type = 'button';
  previous.textContent = 'Anterior';
  var next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Siguiente';
  function drawPage() {
    tbody.replaceChildren();
    var query = normalizarTextoBusqueda(search.value);
    var matchingFeatures = query ? features.filter(function (feature) {
      return fields.some(function (field) {
        var value = (feature.properties || {})[field];
        var text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return normalizarTextoBusqueda(text).indexOf(query) !== -1;
      });
    }) : features;
    var pageCount = Math.max(1, Math.ceil(matchingFeatures.length / pageSize));
    page = Math.min(page, pageCount - 1);
    var start = page * pageSize;
    matchingFeatures.slice(start, start + pageSize).forEach(function (feature) {
      var row = tbody.insertRow();
      fields.forEach(function (field) {
        var cell = row.insertCell();
        var value = (feature.properties || {})[field];
        cell.textContent = value === null || value === undefined ? '' : String(value);
      });
    });
    if (!matchingFeatures.length) {
      var emptyRow = tbody.insertRow();
      var emptyCell = emptyRow.insertCell();
      emptyCell.colSpan = fields.length;
      emptyCell.textContent = 'No hay registros que coincidan con la búsqueda.';
    }
    status.textContent = matchingFeatures.length
      ? 'Registros ' + (start + 1) + '–' + Math.min(start + pageSize, matchingFeatures.length) + ' de ' +
        matchingFeatures.length + (query ? ' encontrados · ' + features.length + ' en total' : '')
      : 'No hay registros que coincidan con la búsqueda.';
    previous.disabled = page === 0;
    next.disabled = start + pageSize >= matchingFeatures.length;
  }
  previous.addEventListener('click', function () { page -= 1; drawPage(); });
  next.addEventListener('click', function () { page += 1; drawPage(); });
  search.addEventListener('input', function () { page = 0; drawPage(); });
  footer.appendChild(status);
  footer.appendChild(previous);
  footer.appendChild(next);
  content.appendChild(search);
  content.appendChild(table);
  content.appendChild(footer);
  drawPage();
}

function cerrarTablaAtributos() {
  var modal = document.getElementById('attributeTableModal');
  if (modal) modal.hidden = true;
}

document.getElementById('closeAttributeTable').addEventListener('click', cerrarTablaAtributos);
document.getElementById('attributeTableModal').addEventListener('click', function (event) {
  if (event.target === this) cerrarTablaAtributos();
});

var welcomeModal = document.getElementById('welcomeModal');
var closeWelcomeBtn = document.getElementById('closeWelcomeBtn');
var openGuideBtn = document.getElementById('openGuideBtn');
var welcomeStep = document.getElementById('welcomeStep');
var guideStep = document.getElementById('guideStep');
var showGuideBtn = document.getElementById('showGuideBtn');
function mostrarPasoGuia() { if (welcomeStep) welcomeStep.hidden = true; if (guideStep) guideStep.hidden = false; }
function mostrarPasoBienvenida() { if (welcomeStep) welcomeStep.hidden = false; if (guideStep) guideStep.hidden = true; }

function cerrarBienvenida() {
  if (welcomeModal) welcomeModal.hidden = true;
}

if (welcomeModal) {
  welcomeModal.hidden = false;
  mostrarPasoBienvenida();
  welcomeModal.addEventListener('click', function (event) {
    if (event.target === welcomeModal) cerrarBienvenida();
  });
}
if (closeWelcomeBtn) closeWelcomeBtn.addEventListener('click', cerrarBienvenida);
if (showGuideBtn) showGuideBtn.addEventListener('click', mostrarPasoGuia);
if (openGuideBtn) openGuideBtn.addEventListener('click', function () {
  if (welcomeModal) welcomeModal.hidden = false;
  mostrarPasoGuia();
});

var reportModal = document.getElementById('reportModal');
var reportForm = document.getElementById('reportForm');
var reportTitleInput = document.getElementById('reportTitle');
var pdfReport = document.getElementById('pdfReport');
var openReportBtn = document.getElementById('openReportBtn');
var reportReturnFocus = null;
var reportOriginalTitle = document.title;
var operationLog = [];
var reportNumberFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

function resumirEntidades(features) {
  var summary = { count: features.length, geometryTypes: {}, polygonAreaM2: null, areaErrors: 0 };
  var polygonArea = 0;
  var hasPolygon = false;
  features.forEach(function (feature) {
    var geometryType = feature && feature.geometry && feature.geometry.type;
    if (!geometryType) return;
    summary.geometryTypes[geometryType] = (summary.geometryTypes[geometryType] || 0) + 1;
    if (window.turf && (geometryType === 'Polygon' || geometryType === 'MultiPolygon')) {
      try {
        var featureArea = areaFeature(feature.geometry);
        if (Number.isFinite(featureArea)) {
          polygonArea += featureArea;
          hasPolygon = true;
        } else summary.areaErrors += 1;
      } catch (error) { summary.areaErrors += 1; }
    }
  });
  if (hasPolygon) summary.polygonAreaM2 = polygonArea;
  return summary;
}

function referenciaCapa(name, features) {
  return { name: name, summary: resumirEntidades(features || []) };
}

function registrarOperacion(operation) {
  operationLog.push(Object.assign({
    executedAt: new Date().toISOString(),
    status: 'completed',
    inputs: [],
    parameters: {},
    warnings: [],
    processedCount: null,
    result: {},
    interpretation: ''
  }, operation));
}

function registrarErrorAnalisis(toolName, message, inputNames, parameters) {
  registrarOperacion({
    tool: toolName,
    status: 'error',
    inputs: (inputNames || []).filter(Boolean).map(function (name) { return { name: name }; }),
    parameters: parameters || {},
    warnings: [message],
    result: { description: 'El procedimiento no produjo una capa de salida.' },
    interpretation: 'No se generaron resultados porque el procedimiento terminó con un error.'
  });
}

function agregarTablaReporte(section, headings, rows) {
  if (!rows.length) return;
  var table = document.createElement('table');
  table.className = 'pdf-report-table';
  var head = table.createTHead().insertRow();
  headings.forEach(function (heading) {
    var cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = heading;
    head.appendChild(cell);
  });
  var body = table.createTBody();
  rows.forEach(function (values) {
    var row = body.insertRow();
    values.forEach(function (value) {
      var cell = row.insertCell();
      cell.textContent = value === null || value === undefined || value === '' ? 'No disponible' : String(value);
    });
  });
  section.appendChild(table);
}

function formatoResumenEntidades(summary) {
  var types = Object.keys(summary.geometryTypes).map(function (type) {
    return type + ': ' + summary.geometryTypes[type].toLocaleString('es-CO');
  });
  return formatoCuentaEntidades(summary.count) + (types.length ? ' (' + types.join(', ') + ')' : '');
}

function formatoCuentaEntidades(count) {
  return count.toLocaleString('es-CO') + (count === 1 ? ' entidad' : ' entidades');
}

function etiquetaReporte(key) {
  var labels = {
    distancia: 'Distancia',
    unidad: 'Unidad',
    disolución: 'Disolución',
    segmentosPorBuffer: 'Segmentos por buffer',
    métodoSolicitado: 'Método solicitado',
    métodoAplicado: 'Método aplicado',
    paleta: 'Paleta',
    campo: 'Campo',
    tipoGráfico: 'Tipo de gráfico',
    tamañoCelda: 'Tamaño de celda',
    campoPonderación: 'Campo de ponderación',
    relaciónEspacial: 'Relación espacial',
    tipoGeometría: 'Tipo de geometría',
    paresEvaluados: 'Pares evaluados',
    zonasGeneradas: 'Zonas generadas',
    superficieCalculada: 'Superficie calculada',
    capaObjetivo: 'Capa objetivo',
    entidadesObjetivoEvaluadas: 'Entidades de la capa objetivo evaluadas',
    entidadesObjetivoIntersectadas: 'Entidades de la capa objetivo intersectadas',
    entidadesObjetivoSinIntersección: 'Entidades de la capa objetivo sin intersección',
    capaDelimitadora: 'Capa delimitadora',
    entidadesAntes: 'Entidades iniciales',
    entidadesDespués: 'Entidades finales',
    superficieResultante: 'Superficie resultante',
    entidadesCapaA: 'Entidades de la capa A',
    entidadesCapaB: 'Entidades de la capa B',
    entidadesGeométricasResultantes: 'Geometrías unificadas',
    camposCapaA: 'Campos de la capa A',
    camposCapaB: 'Campos de la capa B',
    campoAgrupación: 'Campo de agrupación',
    gruposResultantes: 'Grupos resultantes',
    superficieTotalResultante: 'Superficie total resultante',
    capaDeExclusión: 'Capa de exclusión',
    entidadesEliminadas: 'Entidades eliminadas',
    superficieAntes: 'Superficie inicial',
    superficieDespués: 'Superficie final',
    capaDestino: 'Capa destino',
    capaRelacionada: 'Capa relacionada',
    atributosIncorporados: 'Atributos incorporados',
    registrosRelacionados: 'Registros relacionados',
    entidadesDestinoConCoincidencia: 'Entidades destino con coincidencia',
    entidadesDestinoSinCoincidencia: 'Entidades destino sin coincidencia',
    interseccionesGeneradas: 'Intersecciones generadas',
    superficieDeIntersecciones: 'Superficie de intersecciones',
    superficieTotalPorZona: 'Superficie total por zona',
    celdasGeneradas: 'Celdas generadas',
    entidadesAgregadas: 'Entidades agregadas',
    registrosOmitidos: 'Registros omitidos',
    sumaDePonderaciones: 'Suma de ponderaciones',
    registrosSinDato: 'Registros sin dato',
    coberturaDelCampo: 'Cobertura del campo',
    clasesGeneradas: 'Clases generadas',
    entidadesClasificadas: 'Entidades clasificadas',
    entidadesSinDato: 'Entidades sin dato',
    geometríasEliminadas: 'Geometrías eliminadas',
    geometríasModificadas: 'Geometrías modificadas',
    medicion: 'Medición',
    tipoGeometria: 'Tipo de geometría'
  };
  return labels[key] || key;
}

function formatoAreaReporte(summary) {
  if (summary.polygonAreaM2 === null) return summary.areaErrors
    ? 'No calculada (' + summary.areaErrors + ' geometrías no válidas)'
    : 'No calculada';
  return reportNumberFormat.format(summary.polygonAreaM2 / 10000) + ' ha' +
    (summary.areaErrors ? ' (parcial; ' + summary.areaErrors + ' geometrías no válidas)' : '');
}

function etiquetaUnidadDistancia(unit) {
  var labels = { meters: 'metros', kilometers: 'kilómetros', degrees: 'grados', miles: 'millas' };
  return labels[unit] || unit;
}

function nombreCampoIdentificador(feature, index) {
  var properties = feature && feature.properties || {};
  var idField = Object.keys(properties).find(function (field) {
    return /^(id|codigo|cod|nombre|name|matricula|predial|sector|barrio|vereda)/i.test(field) &&
      properties[field] !== null && properties[field] !== undefined && properties[field] !== '';
  });
  return idField ? idField + ': ' + String(properties[idField]) : 'Entidad ' + (index + 1);
}

function cerrarGeneradorReporte() {
  if (reportModal) reportModal.hidden = true;
  if (reportReturnFocus && typeof reportReturnFocus.focus === 'function') reportReturnFocus.focus();
}

function agregarTextoReporte(parent, tagName, text, className) {
  var element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function agregarSeccionReporte(title) {
  var section = document.createElement('section');
  section.className = 'pdf-report-section';
  agregarTextoReporte(section, 'h2', title);
  pdfReport.appendChild(section);
  return section;
}

function crearContenidoReporte() {
  var title = reportTitleInput.value.trim();
  var author = document.getElementById('reportAuthor').value.trim();
  var notes = document.getElementById('reportNotes').value.trim();
  var number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 5 });
  var center = map.getCenter();
  var bounds = map.getBounds();
  var basemapName = Object.keys(basemaps).find(function (name) { return map.hasLayer(basemaps[name]); }) || 'No identificado';
  var activeLayerNames = Object.keys(capas).filter(function (name) { return map.hasLayer(capas[name]); });
  var completedOperations = operationLog.filter(function (operation) { return operation.status === 'completed'; });

  pdfReport.replaceChildren();
  var header = document.createElement('header');
  header.className = 'pdf-report-header';
  agregarTextoReporte(header, 'h1', title);
  agregarTextoReporte(header, 'p', 'INFORME TÉCNICO DE ANÁLISIS GEOGRÁFICO Y TERRITORIAL');
  agregarTextoReporte(header, 'p', 'GeoVisor de Bello · Generado el ' +
    new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short' }).format(new Date()));
  if (author) agregarTextoReporte(header, 'p', 'Elaborado por: ' + author);
  agregarTextoReporte(header, 'p', 'Procedimientos registrados: ' + operationLog.length +
    ' · Completados: ' + completedOperations.length +
    ' · Con error: ' + (operationLog.length - completedOperations.length));
  pdfReport.appendChild(header);

  var objectiveSection = agregarSeccionReporte('Objetivo del procedimiento');
  agregarTextoReporte(objectiveSection, 'p', operationLog.length
    ? 'Documentar las operaciones realizadas en esta sesión del geovisor, sus parámetros, capas de entrada y salida, resultados medibles y limitaciones.'
    : 'Documentar el encuadre cartográfico y las capas visibles. En esta sesión no hay operaciones de análisis registradas.');

  var viewSection = agregarSeccionReporte('Vista del mapa');
  viewSection.classList.add('pdf-report-metadata');
  [
    'Mapa base: ' + basemapName,
    'Área de estudio (encuadre actual): latitud ' + number.format(bounds.getSouth()) + ' a ' + number.format(bounds.getNorth()) +
      ' · longitud ' + number.format(bounds.getWest()) + ' a ' + number.format(bounds.getEast()),
    'Centro: ' + number.format(center.lat) + '; ' + number.format(center.lng),
    'Nivel de zoom: ' + map.getZoom(),
    'Norte: ' + number.format(bounds.getNorth()),
    'Sur: ' + number.format(bounds.getSouth()),
    'Este: ' + number.format(bounds.getEast()),
    'Oeste: ' + number.format(bounds.getWest())
  ].forEach(function (item) { agregarTextoReporte(viewSection, 'p', item); });

  var layerNames = Array.from(new Set(activeLayerNames.concat(operationLog.reduce(function (names, operation) {
    operation.inputs.forEach(function (input) { if (input.name) names.push(input.name); });
    if (operation.outputName) names.push(operation.outputName);
    return names;
  }, []))));
  var layersSection = agregarSeccionReporte('Información de capas utilizadas y visibles');
  agregarTablaReporte(layersSection, ['Capa', 'Entidades disponibles', 'Geometrías', 'Área poligonal calculada'], layerNames.map(function (name) {
    var layer = capas[name];
    var features = layer && layer._attributeFeatures || [];
    var summary = resumirEntidades(features);
    return [
      name + (activeLayerNames.indexOf(name) !== -1 ? ' (visible)' : ''),
      layer && layer._attributesReady ? summary.count.toLocaleString('es-CO') : 'Atributos no cargados',
      Object.keys(summary.geometryTypes).join(', ') || 'No disponible',
      summary.polygonAreaM2 === null ? formatoAreaReporte(summary) : formatoAreaReporte(summary) + ' (suma por entidad)'
    ];
  }));
  agregarTextoReporte(layersSection, 'p', activeLayerNames.length
    ? 'Capas activas al generar el informe: ' + activeLayerNames.join(', ') + '.'
    : 'No hay capas temáticas activas; se muestra únicamente el mapa base.');

  if (operationLog.length) {
    var methodologySection = agregarSeccionReporte('Metodología y herramientas aplicadas');
    agregarTablaReporte(methodologySection, ['Fecha y hora', 'Herramienta', 'Estado', 'Capas de entrada', 'Capa de salida'], operationLog.map(function (operation) {
      return [
        new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(operation.executedAt)),
        operation.tool,
        operation.status === 'completed' ? 'Completado' : 'Error',
        operation.inputs.map(function (input) { return input.name; }).join(', ') || 'No aplica',
        operation.outputName || 'Sin capa'
      ];
    }));

    operationLog.forEach(function (operation, index) {
      var detailSection = agregarSeccionReporte('Procedimiento ' + (index + 1) + ': ' + operation.tool);
      agregarTextoReporte(detailSection, 'p', operation.procedure || operation.result.description || 'Operación registrada en el geovisor.');
      if (operation.inputs.length) {
        agregarTextoReporte(detailSection, 'h3', 'Capas de entrada');
        agregarTablaReporte(detailSection, ['Capa', 'Entidades procesadas', 'Geometrías', 'Superficie poligonal de entrada'], operation.inputs.map(function (input) {
          var summary = input.summary || {};
          return [
            input.name,
            summary.count === undefined ? 'No disponible' : summary.count.toLocaleString('es-CO'),
            summary.geometryTypes ? Object.keys(summary.geometryTypes).join(', ') : 'No disponible',
            summary.polygonAreaM2 === null || summary.polygonAreaM2 === undefined ? formatoAreaReporte(summary) : formatoAreaReporte(summary)
          ];
        }));
      }
      var parameterRows = Object.keys(operation.parameters).map(function (key) {
        var value = operation.parameters[key];
        return [etiquetaReporte(key), typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)];
      });
      if (parameterRows.length) {
        agregarTextoReporte(detailSection, 'h3', 'Parámetros');
        agregarTablaReporte(detailSection, ['Parámetro', 'Valor'], parameterRows);
      }
      if (operation.outputName) {
        agregarTextoReporte(detailSection, 'p', 'Capa de salida: ' + operation.outputName +
          (operation.outputSummary ? ' · ' + formatoResumenEntidades(operation.outputSummary) : ''));
      }
      if (operation.processedCount !== null && operation.processedCount !== undefined) {
        agregarTextoReporte(detailSection, 'p', 'Entidades procesadas: ' + operation.processedCount.toLocaleString('es-CO') + '.');
      }
      var metricRows = Object.keys(operation.result.metrics || {}).map(function (key) {
        return [etiquetaReporte(key), String(operation.result.metrics[key])];
      });
      if (metricRows.length) {
        agregarTextoReporte(detailSection, 'h3', 'Resultados cuantitativos');
        agregarTablaReporte(detailSection, ['Indicador', 'Resultado'], metricRows);
      }
      if (operation.result.rows && operation.result.rows.length) {
        agregarTextoReporte(detailSection, 'h3', 'Detalle de resultados');
        agregarTablaReporte(detailSection, operation.result.rowHeadings || ['Elemento', 'Resultado'], operation.result.rows);
      }
      if (operation.result.entities && operation.result.entities.length) {
        agregarTextoReporte(detailSection, 'p', 'Elementos identificados: ' + operation.result.entities.join('; ') + '.');
      }
      if (operation.interpretation) agregarTextoReporte(detailSection, 'p', 'Interpretación: ' + operation.interpretation);
      (operation.warnings || []).forEach(function (warning) {
        agregarTextoReporte(detailSection, 'p', 'Advertencia: ' + warning, 'pdf-report-warning');
      });
    });
  }

  var drawings = drawnItems.getLayers();
  if (drawings.length) {
    var drawingSection = agregarSeccionReporte('Dibujos y mediciones');
    drawings.forEach(function (layer) {
      var description = layer._measurementType
        ? calcularMedicion(layer, layer._measurementType).message
        : layer instanceof L.Polygon ? 'Polígono dibujado en el mapa' : 'Línea dibujada en el mapa';
      agregarTextoReporte(drawingSection, 'p', description);
    });
  }

  var historySection = agregarSeccionReporte('Historial de modificaciones y procesamiento de información geográfica');
  if (operationLog.length) {
    agregarTablaReporte(historySection, ['Fecha y hora', 'Modificación / proceso', 'Información inicial', 'Resultado final'], operationLog.map(function (operation) {
      var before = operation.inputs.map(function (input) {
        return input.name + (input.summary ? ' (' + formatoCuentaEntidades(input.summary.count) + ')' : '');
      }).join('; ') || 'Sin capa de entrada';
      var after = operation.outputName
        ? operation.outputName + (operation.outputSummary ? ' (' + formatoCuentaEntidades(operation.outputSummary.count) + ')' : '')
        : operation.result.description || 'Sin capa de salida';
      return [
        new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(operation.executedAt)),
        operation.tool,
        before,
        after
      ];
    }));
  } else {
    agregarTextoReporte(historySection, 'p', 'No se registraron modificaciones ni operaciones en esta sesión.');
  }

  var mapSection = agregarSeccionReporte('Mapas de resultados');
  agregarTextoReporte(mapSection, 'p', 'El mapa del encuadre actual se imprime a continuación con las capas visibles y las salidas que permanezcan activadas. No se generó una vista histórica separada por operación.');

  var limitationsSection = agregarSeccionReporte('Observaciones, limitaciones y sistemas de referencia');
  agregarTextoReporte(limitationsSection, 'p', 'Las interpretaciones se limitan a las geometrías, atributos y relaciones espaciales calculadas por las herramientas registradas. Una coincidencia espacial no establece por sí sola una afectación legal, ambiental o predial.');
  agregarTextoReporte(limitationsSection, 'p', 'Las coordenadas del encuadre se expresan como latitud y longitud del mapa web. El visor no conserva en la capa cargada la definición original de proyección (CRS/EPSG); por ello, el sistema de referencia de origen y la precisión posicional deben verificarse en las fuentes cartográficas.');
  agregarTextoReporte(limitationsSection, 'p', 'Las superficies indicadas son estimaciones derivadas de geometrías GeoJSON mediante Turf.js; cuando se suman superficies por entidad pueden contabilizar varias veces zonas solapadas.');

  var conclusionsSection = agregarSeccionReporte('Conclusiones');
  agregarTextoReporte(conclusionsSection, 'p', operationLog.length
    ? 'En esta sesión se completaron ' + completedOperations.length + ' de ' + operationLog.length +
      ' procedimientos registrados. Las conclusiones específicas y sus cifras corresponden únicamente a los resultados expuestos en cada ficha de operación.'
    : 'El documento presenta el encuadre y las capas visibles, sin resultados de análisis espacial registrados.');

  if (notes) {
    var notesSection = agregarSeccionReporte('Observaciones');
    notesSection.classList.add('pdf-report-notes');
    agregarTextoReporte(notesSection, 'p', notes);
  }
  var sourcesSection = agregarSeccionReporte('Fuentes de información');
  agregarTextoReporte(sourcesSection, 'p', 'Capas vectoriales disponibles en este geovisor: ' + Object.keys(capas).join(', ') + '. Mapa base: ' + basemapName + '. La fecha y hora de cada proceso se registran en el historial del informe.');
}

if (openReportBtn && reportModal) {
  openReportBtn.addEventListener('click', function () {
    reportReturnFocus = document.activeElement;
    reportModal.hidden = false;
    if (reportTitleInput) reportTitleInput.focus();
  });
}
['closeReportModal', 'cancelReportModal'].forEach(function (id) {
  var button = document.getElementById(id);
  if (button) button.addEventListener('click', cerrarGeneradorReporte);
});
if (reportModal) reportModal.addEventListener('click', function (event) {
  if (event.target === reportModal) cerrarGeneradorReporte();
});
if (reportForm && pdfReport) reportForm.addEventListener('submit', function (event) {
  event.preventDefault();
  if (!reportTitleInput.value.trim()) {
    reportTitleInput.value = '';
    reportTitleInput.reportValidity();
    return;
  }
  if (!reportForm.reportValidity()) return;
  crearContenidoReporte();
  reportModal.hidden = true;
  pdfReport.hidden = false;
  document.title = reportTitleInput.value.trim();
  window.setTimeout(function () {
    map.invalidateSize();
    window.print();
  }, 100);
});
window.addEventListener('beforeprint', function () {
  map.invalidateSize({ pan: false });
});
window.addEventListener('afterprint', function () {
  if (pdfReport) pdfReport.hidden = true;
  document.title = reportOriginalTitle;
  map.invalidateSize();
  if (reportReturnFocus && typeof reportReturnFocus.focus === 'function') reportReturnFocus.focus();
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    cerrarTablaAtributos();
    if (welcomeModal && !welcomeModal.hidden) cerrarBienvenida();
    if (reportModal && !reportModal.hidden) cerrarGeneradorReporte();
    if (streetViewPanel && !streetViewPanel.hidden) cerrarStreetView();
    if (measurementDrawHandler) measurementDrawHandler.disable();
    else if (polygonDrawHandler) polygonDrawHandler.disable();
  }
});

function actualizarContadorCapas() {
  var count = Object.keys(capas).length;
  var target = document.getElementById('layerCount');
  if (target) {
    target.textContent = String(count);
  }
  llenarSelectoresAnalisis();
  actualizarListaCapas();
}

function mostrarAtributos(feature, layer) {
  var propiedades = feature.properties || {};
  var contenido = document.createElement('article');
  contenido.className = 'feature-card';
  var header = document.createElement('header');
  header.className = 'feature-card-header';
  var title = document.createElement('h3');
  var titleKey = Object.keys(propiedades).find(function (key) { return /^(nombre|name|barrio|vereda|comuna|sector)/i.test(key) && propiedades[key] !== null && propiedades[key] !== ''; });
  title.textContent = titleKey ? String(propiedades[titleKey]) : 'Información del elemento';
  header.appendChild(title);
  var subtitle = document.createElement('p');
  subtitle.textContent = 'Atributos de la capa';
  header.appendChild(subtitle);
  contenido.appendChild(header);

  var fields = Object.entries(propiedades).filter(function (entry) { return entry[0].charAt(0) !== '_' && entry[1] !== null && entry[1] !== undefined && entry[1] !== ''; });
  var details = document.createElement('dl');
  details.className = 'feature-details';
  fields.slice(0, 40).forEach(function (entry) {
    var term = document.createElement('dt');
    term.textContent = entry[0].replace(/_/g, ' ');
    var value = document.createElement('dd');
    value.textContent = typeof entry[1] === 'object' ? JSON.stringify(entry[1]) : String(entry[1]);
    details.append(term, value);
  });
  if (!fields.length) {
    var empty = document.createElement('p');
    empty.textContent = 'Este elemento no tiene atributos disponibles.';
    contenido.appendChild(empty);
  } else {
    contenido.appendChild(details);
    if (fields.length > 40) {
      var note = document.createElement('p');
      note.textContent = 'Se muestran los primeros 40 atributos. Consulta la tabla para verlos todos.';
      contenido.appendChild(note);
    }
  }
  layer.bindPopup(contenido, { maxWidth: 380, maxHeight: 460 });
}

function asegurarCargaCapa(capa) {
  if (capa._loadPromise) return capa._loadPromise;
  if (capa._attributesReady) return Promise.resolve(capa);
  capa._loadPromise = capa._loadData().then(function () {
    capa._attributesReady = true;
    return capa;
  }).catch(function (error) {
    capa._loadPromise = null;
    throw error;
  });
  return capa._loadPromise;
}

function nombreArchivoShapefile(nombre) {
  return String(nombre || 'capa').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'capa';
}

function cargarZipShapefile(rutaZip, nombre, estilo) {
  var capa = L.featureGroup();
  var estiloCapa = estilo || function () {
    return {
      color: '#8adbff',
      weight: 2,
      fillColor: '#4aa6ff',
      fillOpacity: 0.12,
      opacity: 0.8
    };
  };

  capas[nombre] = capa;
  capa._attributeFeatures = [];
  capa._collections = [];
  capa._styleFunction = estiloCapa;
  capa._originalStyleFunction = estiloCapa;
  capa._opacity = 1;
  capa._mapFeaturesReady = false;
  capa._attributesReady = false;
  actualizarContadorCapas();
  capa._loadData = function () {
    var urlShapefile = new URL(rutaZip, document.baseURI).toString();
    return shp(urlShapefile).then(function (datos) {
      var colecciones = datos && datos.type === 'FeatureCollection'
        ? [datos]
        : Array.isArray(datos) ? datos : Object.values(datos || {});

      colecciones.forEach(function (coleccion) {
        if (!coleccion || coleccion.type !== 'FeatureCollection') return;
        capa._collections.push(coleccion);
        capa._attributeFeatures = capa._attributeFeatures.concat(coleccion.features || []);
      });
      return capa;
    });
  };

  return capa;
}

var zipLayerInput = document.getElementById('zipLayerInput');
var zipLayerStatus = document.getElementById('zipLayerStatus');

function mostrarEstadoZip(mensaje, esError) {
  if (!zipLayerStatus) return;
  zipLayerStatus.textContent = mensaje;
  zipLayerStatus.classList.toggle('error', Boolean(esError));
}

function nombreUnicoCapa(nombre) {
  var base = nombre || 'Capa importada';
  var nombreFinal = base;
  var numero = 2;
  while (Object.prototype.hasOwnProperty.call(capas, nombreFinal)) {
    nombreFinal = base + ' (' + numero + ')';
    numero += 1;
  }
  return nombreFinal;
}

function importarZipShapefile(archivo) {
  if (!/\.zip$/i.test(archivo.name)) {
    return Promise.reject(new Error('El archivo «' + archivo.name + '» no tiene extensión .zip.'));
  }
  if (typeof window.shp !== 'function') {
    return Promise.reject(new Error('No está disponible el lector de shapefiles. Comprueba tu conexión y vuelve a cargar el visor.'));
  }

  return archivo.arrayBuffer().then(function (contenido) {
    return window.shp(contenido);
  }).then(function (datos) {
    var colecciones = datos && datos.type === 'FeatureCollection'
      ? [datos]
      : Array.isArray(datos) ? datos : Object.values(datos || {});
    var entidades = [];
    colecciones.forEach(function (coleccion) {
      if (coleccion && coleccion.type === 'FeatureCollection' && Array.isArray(coleccion.features)) {
        entidades = entidades.concat(coleccion.features.filter(function (entidad) {
          return entidad && entidad.type === 'Feature' && entidad.geometry;
        }));
      }
    });
    if (!entidades.length) {
      throw new Error('El ZIP no contiene entidades geográficas legibles. Verifica que incluya archivos .shp, .shx y .dbf.');
    }

    var nombreArchivo = archivo.name.replace(/\.zip$/i, '').trim() || 'Capa importada';
    var nombreCapa = nombreUnicoCapa(nombreArchivo);
    var coleccionUnificada = { type: 'FeatureCollection', features: entidades };
    var capa = L.featureGroup();
    capa._attributeFeatures = entidades;
    capa._collections = [coleccionUnificada];
    capa._styleFunction = function () {
      return { color: '#1769aa', weight: 2, fillColor: '#4aa6ff', fillOpacity: 0.18, opacity: 0.9 };
    };
    capa._originalStyleFunction = capa._styleFunction;
    capa._opacity = 1;
    capa._mapFeaturesReady = false;
    capa._attributesReady = true;
    capa._loadData = function () { return Promise.resolve(capa); };
    capas[nombreCapa] = capa;
    actualizarContadorCapas();

    return prepararRenderizadoCapa(capa).then(function () {
      var bounds = capa.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.08), { maxZoom: 16 });
      actualizarListaCapas();
      return nombreCapa;
    }).catch(function (error) {
      delete capas[nombreCapa];
      actualizarContadorCapas();
      throw error;
    });
  });
}

if (zipLayerInput) {
  zipLayerInput.addEventListener('change', async function () {
    var archivos = Array.from(zipLayerInput.files || []);
    if (!archivos.length) return;
    zipLayerInput.disabled = true;
    var cargadas = [];
    var errores = [];
    mostrarEstadoZip('Leyendo archivos ZIP…');
    try {
      for (var i = 0; i < archivos.length; i += 1) {
        try {
          cargadas.push(await importarZipShapefile(archivos[i]));
        } catch (error) {
          console.error('No se pudo leer el ZIP ' + archivos[i].name + ':', error);
          errores.push(archivos[i].name + ': ' + (error.message || 'error de lectura'));
        }
      }
      if (cargadas.length && errores.length) {
        mostrarEstadoZip('Capas cargadas: ' + cargadas.join(', ') + '. No se pudieron leer: ' + errores.join('; '), true);
      } else if (cargadas.length) {
        mostrarEstadoZip(cargadas.length === 1
          ? 'Capa «' + cargadas[0] + '» cargada en el mapa.'
          : 'Capas cargadas en el mapa: ' + cargadas.join(', ') + '.');
      } else {
        mostrarEstadoZip('No se cargó ninguna capa. ' + errores.join('; '), true);
      }
    } finally {
      zipLayerInput.disabled = false;
      zipLayerInput.value = '';
    }
  });
}

cargarZipShapefile('data/area_predios_quitasol_pca.zip', 'Área de predios Quitasol PCA', function () {
  return {
    color: '#f4a261',
    weight: 1.5,
    fillColor: '#f4a261',
    fillOpacity: 0.16,
    opacity: 0.9
  };
});

cargarZipShapefile('data/barrios_comuna.zip', 'Barrios por comuna', function () {
  return {
    color: '#e76f51',
    weight: 1.5,
    fillColor: '#e76f51',
    fillOpacity: 0.12,
    opacity: 0.85
  };
});

cargarZipShapefile('data/comunas.zip', 'Comunas', function () {
  return {
    color: '#2a9d8f',
    weight: 2,
    fillColor: '#2a9d8f',
    fillOpacity: 0.1,
    opacity: 0.9
  };
});

cargarZipShapefile('data/vias_bello_2019.zip', 'Vías de Bello 2019', function () {
  return {
    color: '#f4d35e',
    weight: 2,
    opacity: 0.9
  };
});

cargarZipShapefile('data/centros_poblados_bello.zip', 'Centros poblados de Bello', function () {
  return {
    color: '#8e44ad',
    weight: 2,
    fillColor: '#c39bd3',
    fillOpacity: 0.65,
    opacity: 0.9
  };
});

cargarZipShapefile('data/veredas_bello.zip', 'Veredas de Bello', function () {
  return {
    color: '#27ae60',
    weight: 2,
    fillColor: '#58d68d',
    fillOpacity: 0.12,
    opacity: 0.9
  };
});

cargarZipShapefile('data/cobertura_bello_2016_2017.zip', 'Cobertura de Bello 2016-2017', function () {
  return {
    color: '#d4ac0d',
    weight: 1,
    fillColor: '#f4d03f',
    fillOpacity: 0.28,
    opacity: 0.85
  };
});

cargarZipShapefile('data/drenaje_doble_bello.zip', 'Drenaje doble de Bello', function () {
  return {
    color: '#2471a3',
    weight: 2,
    opacity: 0.9
  };
});

cargarZipShapefile('data/drenaje_sencillo_bello.zip', 'Drenaje sencillo de Bello', function () {
  return {
    color: '#48c9b0',
    weight: 1,
    opacity: 0.9
  };
});

var resultSequence = 0;
var categoricalPalette = ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#1f78b4', '#b15928', '#6a3d9a', '#fb9a99', '#33a02c'];
var sequentialPalettes = {
  blue: ['#f1f7fb', '#dceaf3', '#c5dceb', '#a5cde0', '#7fb9d4', '#58a4c8', '#348bb7', '#176f9e', '#084d77'],
  red: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef4533', '#cb181d', '#a50f15', '#67000d'],
  green: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#4caf62', '#2f8f4e', '#18743b', '#075528'],
  orange: ['#fff7ec', '#fee8c8', '#fdd49e', '#fdbb74', '#f99d4c', '#ed7d28', '#d95f0e', '#b84206', '#7f2704'],
  diverging: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b']
};

function colorHslAHex(hue, saturation, lightness) {
  var s = saturation / 100, l = lightness / 100;
  var chroma = (1 - Math.abs(2 * l - 1)) * s;
  var section = hue / 60;
  var x = chroma * (1 - Math.abs(section % 2 - 1));
  var rgb = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  var match = l - chroma / 2;
  return '#' + rgb.map(function (value) { return Math.round((value + match) * 255).toString(16).padStart(2, '0'); }).join('');
}

function coloresClasificacion(cantidad, method, field, selectedPalette) {
  if (method === 'unique') {
    return Array.from({ length: cantidad }, function (_, index) {
      if (index < categoricalPalette.length) return categoricalPalette[index];
      var hue = (index * 137.508) % 360;
      return colorHslAHex(hue, 58, 46);
    });
  }
  var nombreCampo = String(field || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var paletteName = selectedPalette && selectedPalette !== 'auto' ? selectedPalette
    : /cambio|variaci|diferencia|balance|anomal/.test(nombreCampo) ? 'diverging'
    : /riesgo|amenaza|suscept|vulnerab|peligro|critic/.test(nombreCampo) ? 'red'
      : /veget|bosque|cobertura|verde|arbol/.test(nombreCampo) ? 'green'
        : /lluvia|precipit|agua|dren|caudal/.test(nombreCampo) ? 'blue'
          : /temperat|calor|incendio/.test(nombreCampo) ? 'orange' : 'blue';
  var palette = sequentialPalettes[paletteName];
  return Array.from({ length: cantidad }, function (_, index) {
    var position = cantidad < 2 ? 0 : Math.round(index * (palette.length - 1) / (cantidad - 1));
    return palette[position];
  });
}

function crearGruposCuantiles(numbers, requestedCount) {
  var cuts = [];
  for (var position = 1; position < numbers.length; position += 1) {
    if (numbers[position - 1] < numbers[position]) cuts.push(position);
  }
  var boundaries = [];
  var previous = 0;
  for (var classIndex = 1; classIndex < requestedCount && boundaries.length < cuts.length; classIndex += 1) {
    var target = Math.ceil(numbers.length * classIndex / requestedCount);
    var remainingCuts = Math.min(requestedCount - classIndex - 1, cuts.length - boundaries.length - 1);
    var candidates = cuts.filter(function (cut, index) {
      return cut > previous && cuts.length - index - 1 >= remainingCuts;
    });
    if (!candidates.length) break;
    var closest = candidates.reduce(function (best, cut) {
      return Math.abs(cut - target) < Math.abs(best - target) ? cut : best;
    }, candidates[0]);
    boundaries.push(closest);
    previous = closest;
  }

  var groups = [];
  var start = 0;
  boundaries.concat([numbers.length]).forEach(function (end) {
    var lower = numbers[start];
    var upper = numbers[end - 1];
    groups.push({
      min: lower,
      max: upper,
      label: lower === upper ? lower.toLocaleString('es-CO') :
        lower.toLocaleString('es-CO', { maximumFractionDigits: 2 }) + ' – ' +
        upper.toLocaleString('es-CO', { maximumFractionDigits: 2 })
    });
    start = end;
  });
  return groups;
}

function calcularCantidadClasesAutomatica(valueCount, distinctValueCount) {
  if (valueCount <= 1 || distinctValueCount <= 1) return 1;
  var sturgesCount = Math.ceil(1 + Math.log(valueCount) / Math.LN2);
  return Math.min(12, distinctValueCount, Math.max(2, sturgesCount));
}

function indiceGrupoClasificacion(value, groups, method) {
  if (method === 'unique') {
    return groups.findIndex(function (group) { return String(value) === String(group.value); });
  }
  var number = Number(value);
  if (!Number.isFinite(number)) return -1;
  return groups.findIndex(function (group, index) {
    if (number < group.min) return false;
    if (group.upperExclusive && index < groups.length - 1) return number < group.max;
    return number <= group.max || index === groups.length - 1 && number >= group.min;
  });
}

function colorClasificacionParaEntidad(feature, field, groups, colors, method) {
  var value = feature.properties && feature.properties[field];
  if (value === null || value === undefined || typeof value === 'string' && value.trim() === '') return null;
  var index = indiceGrupoClasificacion(value, groups, method);
  return index < 0 ? null : colors[index];
}
var analysisMessage = document.getElementById('analysisMessage');
var analysisGuide = document.getElementById('analysisGuide');
var acceptAnalysisGuide = document.getElementById('acceptAnalysisGuide');
var analysisGuideStorageKey = 'geovisor.analysisGuideAccepted';
var turfLoadPromise = null;

try {
  if (analysisGuide && localStorage.getItem(analysisGuideStorageKey) === 'true') {
    analysisGuide.hidden = true;
  }
} catch (storageError) {
  console.warn('No se pudo recuperar la preferencia de la guía de análisis:', storageError);
}

if (acceptAnalysisGuide) {
  acceptAnalysisGuide.addEventListener('click', function () {
    if (analysisGuide) analysisGuide.hidden = true;
    try {
      localStorage.setItem(analysisGuideStorageKey, 'true');
    } catch (storageError) {
      console.warn('No se pudo guardar la preferencia de la guía de análisis:', storageError);
    }
  });
}

function asegurarTurf() {
  if (window.turf) return Promise.resolve(window.turf);
  if (turfLoadPromise) return turfLoadPromise;
  turfLoadPromise = new Promise(function (resolve, reject) {
    function cargar(url, respaldo) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = function () {
        if (window.turf) resolve(window.turf);
        else if (respaldo) cargar(respaldo, null);
        else reject(new Error('El motor de análisis se descargó, pero no pudo inicializarse.'));
      };
      script.onerror = function () {
        if (respaldo) cargar(respaldo, null);
        else reject(new Error('No se pudo cargar Turf.js. Revisa tu conexión a internet e inténtalo de nuevo.'));
      };
      document.head.appendChild(script);
    }
    cargar('https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js', 'https://unpkg.com/@turf/turf@7.2.0/turf.min.js');
  }).catch(function (error) { turfLoadPromise = null; throw error; });
  return turfLoadPromise;
}

function avisarAnalisis(message, isError) {
  if (!analysisMessage) return;
  analysisMessage.textContent = message;
  analysisMessage.classList.toggle('error', Boolean(isError));
}

function llenarSelectoresAnalisis() {
  [
    'bufferLayer', 'bufferTargetLayer', 'clipLayer', 'clipMaskLayer', 'unionLayerA', 'unionLayerB',
    'dissolveLayer', 'eraseLayer', 'eraseMaskLayer', 'spatialJoinLayer', 'spatialJoinSourceLayer',
    'classLayer', 'overlayLayerA', 'overlayLayerB', 'accessLayer', 'heatLayer', 'chartLayer'
  ].forEach(function (id) {
    var select = document.getElementById(id);
    if (!select) return;
    var selected = select.value;
    select.replaceChildren();
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = id === 'bufferTargetLayer' ? 'Sin comparación de entidades' : 'Selecciona una capa';
    placeholder.disabled = id !== 'bufferTargetLayer';
    placeholder.selected = true;
    select.appendChild(placeholder);
    Object.keys(capas).forEach(function (name) {
      var option = document.createElement('option'); option.value = name; option.textContent = name; select.appendChild(option);
    });
    if (Object.prototype.hasOwnProperty.call(capas, selected)) select.value = selected;
  });
}

function crearCapaResultado(nombre, features) {
  resultSequence += 1;
  var finalName = nombre + ' (' + resultSequence + ')';
  var group = L.featureGroup();
  var collection = { type: 'FeatureCollection', features: features };
  group._attributeFeatures = features;
  group._collections = [collection];
  group._opacity = 1;
  group._styleFunction = function (feature) {
    if (feature && feature.properties && feature.properties._heatColor) {
      return { color: feature.properties._heatColor, weight: 1, fillColor: feature.properties._heatColor, fillOpacity: .28, opacity: .7 };
    }
    return { color: '#7c3aed', weight: 2, fillColor: '#a78bfa', fillOpacity: .35 };
  };
  group._mapFeaturesReady = true;
  group._attributesReady = true;
  group.addLayer(L.geoJSON(collection, {
    style: function (feature) { return ajustarEstiloOpacidad(group, group._styleFunction(feature)); },
    pointToLayer: function (feature, latlng) {
      var properties = feature.properties || {};
      return L.circleMarker(latlng, {
        radius: Number(properties._heatRadius) || 10,
        color: properties._heatColor || '#7c3aed',
        weight: 1,
        fillColor: properties._heatColor || '#a78bfa',
        fillOpacity: .28,
        opacity: .7
      });
    },
    onEachFeature: mostrarAtributos
  }));
  capas[finalName] = group;
  llenarSelectoresAnalisis();
  group.addTo(map);
  actualizarListaCapas();
  var bounds = group.getBounds(); if (bounds.isValid()) map.fitBounds(bounds.pad(.12), { maxZoom: 16 });
  return finalName;
}

function areaFeature(geometry) { return turf.area({ type: 'Feature', properties: {}, geometry: geometry }); }

function cargarFuncionesLayer(name) {
  if (!name || !capas[name]) return Promise.reject(new Error('Selecciona una capa.'));
  return asegurarCargaCapa(capas[name]).then(function (layer) {
    return { layer: layer, features: (layer._attributeFeatures || []).filter(function (feature) { return feature && feature.geometry; }) };
  });
}

function llenarCamposDeCapa(layerName, selectId, permitirVacio) {
  var select = document.getElementById(selectId);
  if (!select) return;
  var previous = select.value;
  select.replaceChildren();
  if (permitirVacio) {
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Sin ponderación';
    select.appendChild(empty);
  }
  var layer = capas[layerName];
  var fields = [];
  (layer && layer._attributeFeatures || []).forEach(function (feature) {
    Object.keys(feature.properties || {}).forEach(function (field) {
      if (field.charAt(0) !== '_' && fields.indexOf(field) === -1) fields.push(field);
    });
  });
  fields.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  fields.forEach(function (field) {
    var option = document.createElement('option');
    option.value = field;
    option.textContent = field;
    select.appendChild(option);
  });
  if (fields.indexOf(previous) !== -1) select.value = previous;
}

function yieldToBrowser() {
  return new Promise(function (resolve) {
    var yielded = false;
    var fallback = window.setTimeout(finish, 50);
    function finish() {
      if (yielded) return;
      yielded = true;
      window.clearTimeout(fallback);
      resolve();
    }
    if (window.requestAnimationFrame) window.requestAnimationFrame(finish);
  });
}

function cajasSeCruzan(a, b) {
  return a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cajaGeometria(feature) {
  try { return turf.bbox(feature); } catch (error) { return null; }
}

function esPoligono(feature) {
  return feature && feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon');
}

function camposDisponibles(features) {
  var fields = [];
  features.forEach(function (feature) {
    Object.keys(feature.properties || {}).forEach(function (field) {
      if (field.charAt(0) !== '_' && fields.indexOf(field) === -1) fields.push(field);
    });
  });
  return fields;
}

function unirGeometriasPoligonales(features) {
  if (!features.length) return null;
  return features.length === 1 ? features[0] : turf.union(turf.featureCollection(features));
}

function superficiePoligonalHa(features) {
  return reportNumberFormat.format(features.reduce(function (sum, feature) {
    return sum + areaFeature(feature.geometry);
  }, 0) / 10000);
}

document.getElementById('runClip').addEventListener('click', async function () {
  var button = this;
  var sourceName = document.getElementById('clipLayer').value;
  var maskName = document.getElementById('clipMaskLayer').value;
  button.disabled = true;
  try {
    await asegurarTurf();
    if (!sourceName || !maskName || sourceName === maskName) throw new Error('Selecciona dos capas diferentes.');
    var inputs = await Promise.all([sourceName, maskName].map(cargarFuncionesLayer));
    var source = inputs[0].features;
    var masks = inputs[1].features;
    if (!source.length || !masks.length || !source.every(esPoligono) || !masks.every(esPoligono)) {
      throw new Error('Clip requiere dos capas con geometrías poligonales válidas.');
    }
    if (source.length * masks.length > 250000) throw new Error('El recorte supera 250.000 pares posibles. Elige capas más pequeñas.');
    var clipped = [];
    var errors = 0;
    var checked = 0;
    var maskBoxes = masks.map(cajaGeometria);
    for (var i = 0; i < source.length; i += 1) {
      var sourceBox = cajaGeometria(source[i]);
      for (var j = 0; j < masks.length; j += 1) {
        checked += 1;
        if (checked % 5000 === 0) await yieldToBrowser();
        if (!cajasSeCruzan(sourceBox, maskBoxes[j])) continue;
        try {
          var result = turf.intersect(turf.featureCollection([source[i], masks[j]]));
          if (!result || !result.geometry) continue;
          result.properties = Object.assign({}, source[i].properties || {}, {
            entidad_origen: i + 1,
            capa_delimitadora: maskName,
            entidad_delimitadora: j + 1
          });
          clipped.push(result);
        } catch (geometryError) { errors += 1; }
      }
      if ((i + 1) % 100 === 0) await yieldToBrowser();
    }
    var outputName = crearCapaResultado('Recorte de ' + sourceName, clipped);
    var outputSummary = resumirEntidades(clipped);
    registrarOperacion({
      tool: 'Recorte espacial (clip)',
      inputs: [referenciaCapa(sourceName, source), referenciaCapa(maskName, masks)],
      outputName: outputName,
      outputSummary: outputSummary,
      procedure: 'Se conservaron las porciones de las entidades poligonales de la capa original que caen dentro de la capa delimitadora.',
      processedCount: source.length,
      parameters: { capaDelimitadora: maskName, paresEvaluados: checked },
      result: {
        metrics: {
          entidadesAntes: source.length,
          entidadesDespués: clipped.length,
          superficieResultante: superficiePoligonalHa(clipped) + ' ha'
        },
        entities: clipped.slice(0, 40).map(function (feature, index) { return nombreCampoIdentificador(feature, index); })
      },
      warnings: errors ? [errors + ' pares con geometrías inválidas fueron omitidos.'] : [],
      interpretation: clipped.length
        ? 'El recorte conservó ' + clipped.length + ' porciones espaciales de «' + sourceName + '» dentro de «' + maskName + '». Los atributos conservados corresponden a la capa original.'
        : 'No se encontraron geometrías de «' + sourceName + '» dentro de la extensión de «' + maskName + '».'
    });
    avisarAnalisis('Clip finalizado: ' + clipped.length + ' entidades resultantes en «' + outputName + '».');
  } catch (error) {
    console.error('No se pudo ejecutar Clip:', error);
    registrarErrorAnalisis('Recorte espacial (clip)', error.message, [sourceName, maskName], {});
    avisarAnalisis(error.message || 'No se pudo ejecutar Clip.', true);
  } finally { button.disabled = false; }
});

document.getElementById('runUnion').addEventListener('click', async function () {
  var button = this;
  var names = [document.getElementById('unionLayerA').value, document.getElementById('unionLayerB').value];
  button.disabled = true;
  try {
    await asegurarTurf();
    if (!names[0] || !names[1] || names[0] === names[1]) throw new Error('Selecciona dos capas diferentes.');
    var inputs = await Promise.all(names.map(cargarFuncionesLayer));
    if (!inputs[0].features.length || !inputs[1].features.length) throw new Error('Ambas capas deben contener geometrías para realizar Union.');
    var features = inputs[0].features.concat(inputs[1].features);
    if (!features.length || !features.every(esPoligono)) throw new Error('Union requiere capas con geometrías poligonales.');
    if (features.length > 1000) throw new Error('La unión supera 1.000 geometrías y no se ejecutó para evitar bloquear el navegador.');
    var merged = unirGeometriasPoligonales(features);
    if (!merged || !merged.geometry) throw new Error('No fue posible unificar las geometrías seleccionadas.');
    var fieldsA = camposDisponibles(inputs[0].features);
    var fieldsB = camposDisponibles(inputs[1].features);
    merged.properties = {
      capa_a: names[0],
      entidades_capa_a: inputs[0].features.length,
      campos_capa_a: fieldsA.join(', '),
      capa_b: names[1],
      entidades_capa_b: inputs[1].features.length,
      campos_capa_b: fieldsB.join(', ')
    };
    var outputName = crearCapaResultado('Unión de ' + names[0] + ' y ' + names[1], [merged]);
    var outputSummary = resumirEntidades([merged]);
    registrarOperacion({
      tool: 'Unión espacial de geometrías (union)',
      inputs: [referenciaCapa(names[0], inputs[0].features), referenciaCapa(names[1], inputs[1].features)],
      outputName: outputName,
      outputSummary: outputSummary,
      procedure: 'Se combinaron las geometrías poligonales de ambas capas en una cobertura unificada.',
      processedCount: features.length,
      parameters: { capas: names, camposCapaA: fieldsA, camposCapaB: fieldsB },
      result: {
        metrics: {
          entidadesCapaA: inputs[0].features.length,
          entidadesCapaB: inputs[1].features.length,
          entidadesGeométricasResultantes: 1,
          superficieResultante: superficiePoligonalHa([merged]) + ' ha'
        },
        rows: [
          ['Capa A', names[0], fieldsA.join(', ') || 'Sin atributos'],
          ['Capa B', names[1], fieldsB.join(', ') || 'Sin atributos']
        ],
        rowHeadings: ['Origen', 'Capa', 'Campos disponibles']
      },
      warnings: ['La unión produce una geometría agregada; los valores de atributos no se fusionan registro a registro. Se informan los campos disponibles en cada origen.'],
      interpretation: 'La cobertura resultante representa la unión geométrica de las dos capas. La geometría no conserva una correspondencia individual entre cada atributo de origen y cada porción resultante.'
    });
    avisarAnalisis('Se combinaron las geometrías de «' + names[0] + '» y «' + names[1] + '» en «' + outputName + '».');
  } catch (error) {
    console.error('No se pudo ejecutar Union:', error);
    registrarErrorAnalisis('Unión espacial de geometrías (union)', error.message, names, {});
    avisarAnalisis(error.message || 'No se pudo ejecutar Union.', true);
  } finally { button.disabled = false; }
});

document.getElementById('dissolveLayer').addEventListener('change', async function () {
  try {
    await asegurarCargaCapa(capas[this.value]);
    llenarCamposDeCapa(this.value, 'dissolveField', false);
  } catch (error) {
    avisarAnalisis(error.message || 'No se pudieron cargar los campos para Dissolve.', true);
  }
});

document.getElementById('runDissolve').addEventListener('click', async function () {
  var button = this;
  var name = document.getElementById('dissolveLayer').value;
  var field = document.getElementById('dissolveField').value;
  button.disabled = true;
  try {
    await asegurarTurf();
    var input = await cargarFuncionesLayer(name);
    var features = input.features;
    if (!features.length || !features.every(esPoligono)) throw new Error('Dissolve requiere una capa poligonal.');
    if (features.length > 5000) throw new Error('Dissolve supera 5.000 geometrías; elige una capa más pequeña para evitar bloquear el navegador.');
    if (!field) throw new Error('Selecciona un campo para agrupar las entidades.');
    var grouped = new Map();
    features.forEach(function (feature) {
      var value = feature.properties && feature.properties[field];
      var key = value === null || value === undefined ? '__sin_dato__' : typeof value + ':' + String(value);
      if (!grouped.has(key)) grouped.set(key, { value: value, features: [] });
      grouped.get(key).features.push(feature);
    });
    var dissolved = [];
    grouped.forEach(function (group) {
      var geometry = unirGeometriasPoligonales(group.features);
      if (!geometry || !geometry.geometry) throw new Error('No fue posible disolver uno de los grupos de «' + field + '».');
      var properties = {};
      properties[field] = group.value === null || group.value === undefined ? 'Sin dato' : group.value;
      properties.entidades_origen = group.features.length;
      dissolved.push(Object.assign({}, geometry, { properties: properties }));
    });
    var outputName = crearCapaResultado('Disolución de ' + name + ' por ' + field, dissolved);
    var outputSummary = resumirEntidades(dissolved);
    registrarOperacion({
      tool: 'Disolución por atributo (dissolve)',
      inputs: [referenciaCapa(name, features)],
      outputName: outputName,
      outputSummary: outputSummary,
      procedure: 'Se agruparon las entidades por el valor de «' + field + '» y se unificaron las geometrías de cada grupo.',
      processedCount: features.length,
      parameters: { campoAgrupación: field },
      result: {
        metrics: {
          entidadesAntes: features.length,
          gruposResultantes: dissolved.length,
          superficieTotalResultante: superficiePoligonalHa(dissolved) + ' ha'
        },
        rows: Array.from(grouped.values()).slice(0, 100).map(function (group) {
          return [group.value === null || group.value === undefined ? 'Sin dato' : String(group.value), String(group.features.length)];
        }),
        rowHeadings: [field, 'Entidades agrupadas']
      },
      interpretation: 'La disolución redujo ' + features.length + ' entidades a ' + dissolved.length +
        ' geometrías agrupadas por «' + field + '». La superficie total es la suma de las áreas resultantes.'
    });
    avisarAnalisis('Dissolve creó ' + dissolved.length + ' grupos en «' + outputName + '».');
  } catch (error) {
    console.error('No se pudo ejecutar Dissolve:', error);
    registrarErrorAnalisis('Disolución por atributo (dissolve)', error.message, [name], { campoAgrupación: field });
    avisarAnalisis(error.message || 'No se pudo ejecutar Dissolve.', true);
  } finally { button.disabled = false; }
});

document.getElementById('runErase').addEventListener('click', async function () {
  var button = this;
  var names = [document.getElementById('eraseLayer').value, document.getElementById('eraseMaskLayer').value];
  button.disabled = true;
  try {
    await asegurarTurf();
    if (!names[0] || !names[1] || names[0] === names[1]) throw new Error('Selecciona dos capas diferentes.');
    var inputs = await Promise.all(names.map(cargarFuncionesLayer));
    var source = inputs[0].features;
    var masks = inputs[1].features;
    if (!source.length || !masks.length || !source.every(esPoligono) || !masks.every(esPoligono)) {
      throw new Error('Erase requiere dos capas con geometrías poligonales.');
    }
    if (source.length * masks.length > 250000) throw new Error('El borrado supera 250.000 pares posibles. Elige capas más pequeñas.');
    var mask = unirGeometriasPoligonales(masks);
    if (!mask || !mask.geometry) throw new Error('No fue posible unificar las geometrías de exclusión.');
    var erased = [];
    var errors = 0;
    for (var i = 0; i < source.length; i += 1) {
      try {
        if (!cajasSeCruzan(cajaGeometria(source[i]), cajaGeometria(mask)) || !turf.booleanIntersects(source[i], mask)) {
          erased.push(source[i]);
          continue;
        }
        var remainder = turf.difference(turf.featureCollection([source[i], mask]));
        if (remainder && remainder.geometry) {
          remainder.properties = Object.assign({}, source[i].properties || {}, { entidad_origen: i + 1, capa_exclusion: names[1] });
          erased.push(remainder);
        }
      } catch (geometryError) {
        errors += 1;
        erased.push(source[i]);
      }
      if ((i + 1) % 100 === 0) await yieldToBrowser();
    }
    var outputName = crearCapaResultado('Erase de ' + names[0] + ' por ' + names[1], erased);
    var outputSummary = resumirEntidades(erased);
    var inputArea = resumirEntidades(source).polygonAreaM2;
    var outputArea = outputSummary.polygonAreaM2;
    registrarOperacion({
      tool: 'Borrado espacial (erase)',
      inputs: [referenciaCapa(names[0], source), referenciaCapa(names[1], masks)],
      outputName: outputName,
      outputSummary: outputSummary,
      procedure: 'Se sustrajeron de cada polígono de entrada las superficies cubiertas por la capa de exclusión.',
      processedCount: source.length,
      parameters: { capaDeExclusión: names[1] },
      result: {
        metrics: {
          entidadesAntes: source.length,
          entidadesDespués: erased.length,
          entidadesEliminadas: source.length - erased.length,
          superficieAntes: inputArea === null ? 'No calculada' : reportNumberFormat.format(inputArea / 10000) + ' ha',
          superficieDespués: outputArea === null ? 'No calculada' : reportNumberFormat.format(outputArea / 10000) + ' ha'
        }
      },
      warnings: errors ? [errors + ' geometrías no válidas se conservaron sin cambios.'] : [],
      interpretation: 'Se conservaron las porciones de «' + names[0] + '» fuera de «' + names[1] +
        '». Las entidades completamente cubiertas por la máscara se excluyeron; las áreas informadas son estimaciones geométricas.'
    });
    avisarAnalisis('Erase produjo ' + erased.length + ' entidades en «' + outputName + '».');
  } catch (error) {
    console.error('No se pudo ejecutar Erase:', error);
    registrarErrorAnalisis('Borrado espacial (erase)', error.message, names, {});
    avisarAnalisis(error.message || 'No se pudo ejecutar Erase.', true);
  } finally { button.disabled = false; }
});

document.getElementById('runSpatialJoin').addEventListener('click', async function () {
  var button = this;
  var names = [document.getElementById('spatialJoinLayer').value, document.getElementById('spatialJoinSourceLayer').value];
  button.disabled = true;
  try {
    await asegurarTurf();
    if (!names[0] || !names[1] || names[0] === names[1]) throw new Error('Selecciona dos capas diferentes.');
    var inputs = await Promise.all(names.map(cargarFuncionesLayer));
    var targets = inputs[0].features;
    var sources = inputs[1].features;
    if (!targets.length || !sources.length) throw new Error('Las capas seleccionadas no contienen entidades con geometría.');
    if (targets.length * sources.length > 250000) throw new Error('Spatial Join supera 250.000 pares posibles. Elige capas más pequeñas.');
    var sourceFields = camposDisponibles(sources);
    var joined = [];
    var relatedCount = 0;
    var invalid = 0;
    var checked = 0;
    for (var i = 0; i < targets.length; i += 1) {
      var result = Object.assign({}, targets[i]);
      var properties = Object.assign({}, targets[i].properties || {});
      var matchCount = 0;
      var firstMatch = null;
      for (var j = 0; j < sources.length; j += 1) {
        checked += 1;
        if (checked % 5000 === 0) await yieldToBrowser();
        if (!cajasSeCruzan(cajaGeometria(targets[i]), cajaGeometria(sources[j]))) continue;
        try {
          if (!turf.booleanIntersects(targets[i], sources[j])) continue;
          matchCount += 1;
          if (!firstMatch) firstMatch = sources[j];
        } catch (geometryError) { invalid += 1; }
      }
      relatedCount += matchCount;
      sourceFields.forEach(function (field) {
        if (firstMatch && firstMatch.properties && firstMatch.properties[field] !== undefined) {
          properties['join_' + field] = firstMatch.properties[field];
        }
      });
      properties.join_match_count = matchCount;
      properties.join_source_layer = names[1];
      result.properties = properties;
      joined.push(result);
      if ((i + 1) % 100 === 0) await yieldToBrowser();
    }
    var matchedTargets = joined.filter(function (feature) { return feature.properties.join_match_count > 0; }).length;
    var outputName = crearCapaResultado('Spatial Join de ' + names[0] + ' con ' + names[1], joined);
    var outputSummary = resumirEntidades(joined);
    registrarOperacion({
      tool: 'Unión espacial de atributos (spatial join)',
      inputs: [referenciaCapa(names[0], targets), referenciaCapa(names[1], sources)],
      outputName: outputName,
      outputSummary: outputSummary,
      procedure: 'Se evaluó la relación intersects para cada entidad destino y se incorporaron los atributos de la primera coincidencia; el total de coincidencias se conserva en join_match_count.',
      processedCount: targets.length,
      parameters: { relaciónEspacial: 'intersects', capaDestino: names[0], capaRelacionada: names[1], atributosIncorporados: sourceFields.map(function (field) { return 'join_' + field; }) },
      result: {
        metrics: {
          registrosRelacionados: relatedCount,
          entidadesDestinoConCoincidencia: matchedTargets,
          entidadesDestinoSinCoincidencia: targets.length - matchedTargets,
          atributosIncorporados: sourceFields.length
        },
        rows: joined.slice(0, 100).map(function (feature, index) {
          return [nombreCampoIdentificador(feature, index), String(feature.properties.join_match_count)];
        }),
        rowHeadings: ['Entidad destino', 'Coincidencias espaciales']
      },
      warnings: invalid ? [invalid + ' pares con geometrías no válidas no pudieron evaluarse.'] : [],
      interpretation: matchedTargets + ' de ' + targets.length + ' entidades destino presentan relación espacial intersects con «' +
        names[1] + '». Los atributos incorporados corresponden a la primera entidad coincidente; el conteo registra todas las coincidencias.'
    });
    avisarAnalisis('Spatial Join relacionó ' + matchedTargets + ' de ' + targets.length + ' entidades destino.');
  } catch (error) {
    console.error('No se pudo ejecutar Spatial Join:', error);
    registrarErrorAnalisis('Unión espacial de atributos (spatial join)', error.message, names, {});
    avisarAnalisis(error.message || 'No se pudo ejecutar Spatial Join.', true);
  } finally { button.disabled = false; }
});

document.getElementById('runOverlay').addEventListener('click', async function () {
  var button = this;
  button.disabled = true;
  try {
    avisarAnalisis('Cargando motor y capas para la superposición…');
    await asegurarTurf();
    var names = [document.getElementById('overlayLayerA').value, document.getElementById('overlayLayerB').value];
    if (!names[0] || !names[1] || names[0] === names[1]) throw new Error('Selecciona dos capas diferentes.');
    var inputs = await Promise.all(names.map(cargarFuncionesLayer));
    var first = inputs[0].features;
    var second = inputs[1].features;
    if (!first.length || !second.length) throw new Error('Una de las capas no contiene geometrías.');
    if (!first.every(esPoligono) || !second.every(esPoligono)) throw new Error('La superposición de áreas requiere dos capas compuestas por polígonos.');
    if (first.length * second.length > 250000) throw new Error('El cruce supera 250.000 pares posibles. Elige capas más pequeñas para evitar bloquear el navegador.');
    var bboxesA = first.map(cajaGeometria);
    var bboxesB = second.map(cajaGeometria);
    var intersections = [];
    var errors = 0;
    var checked = 0;
    for (var i = 0; i < first.length; i += 1) {
      for (var j = 0; j < second.length; j += 1) {
        checked += 1;
        if (checked % 5000 === 0) {
          avisarAnalisis('Buscando intersecciones: ' + checked.toLocaleString('es-CO') + ' pares revisados…');
          await yieldToBrowser();
        }
        if (!cajasSeCruzan(bboxesA[i], bboxesB[j])) continue;
        try {
          var intersection = turf.intersect(turf.featureCollection([first[i], second[j]]));
          if (intersection && intersection.geometry) {
            var intersectionProperties = {
              capa_referencia: names[0],
              entidad_referencia: i + 1,
              capa_cruzada: names[1],
              entidad_cruzada: j + 1,
              area_m2: Math.round(areaFeature(intersection.geometry) * 100) / 100
            };
            Object.keys(first[i].properties || {}).forEach(function (field) {
              intersectionProperties['referencia_' + field] = first[i].properties[field];
            });
            Object.keys(second[j].properties || {}).forEach(function (field) {
              intersectionProperties['cruce_' + field] = second[j].properties[field];
            });
            intersection.properties = intersectionProperties;
            intersections.push(intersection);
          }
        } catch (geometryError) { errors += 1; }
      }
    }
    if (!intersections.length) throw new Error('Las capas seleccionadas no tienen geometrías de área que se intersecten.');
    var resultName = crearCapaResultado('Superposición ' + names[0] + ' y ' + names[1], intersections);
    var intersectionArea = intersections.reduce(function (sum, feature) { return sum + areaFeature(feature.geometry); }, 0);
    registrarOperacion({
      tool: 'Superposición espacial (intersect)',
      inputs: [referenciaCapa(names[0], first), referenciaCapa(names[1], second)],
      outputName: resultName,
      outputSummary: resumirEntidades(intersections),
      procedure: 'Se evaluaron pares de polígonos y se conservaron las geometrías de intersección con atributos de ambas capas.',
      processedCount: checked,
      parameters: { tipoGeometría: 'polígono', paresEvaluados: checked },
      result: {
        metrics: {
          interseccionesGeneradas: intersections.length,
          superficieDeIntersecciones: reportNumberFormat.format(intersectionArea / 10000) + ' ha (suma por intersección)'
        },
        rows: intersections.slice(0, 30).map(function (feature) {
          var properties = feature.properties || {};
          var referenceIndex = Number(properties.entidad_referencia) - 1;
          var crossedIndex = Number(properties.entidad_cruzada) - 1;
          return [
            nombreCampoIdentificador(first[referenceIndex], referenceIndex),
            nombreCampoIdentificador(second[crossedIndex], crossedIndex),
            reportNumberFormat.format(properties.area_m2) + ' m²'
          ];
        }),
        rowHeadings: ['Entidad capa de referencia', 'Entidad capa cruzada', 'Superficie']
      },
      warnings: errors ? [errors + ' pares tuvieron geometrías no válidas y fueron omitidos.'] : [],
      interpretation: 'Se identificaron ' + intersections.length + ' pares de entidades con superposición geométrica entre las capas seleccionadas. La superficie es la suma de las intersecciones calculadas y puede contar varias veces zonas solapadas entre pares.'
    });
    avisarAnalisis('Se generaron ' + intersections.length + ' intersecciones en «' + resultName + '».' + (errors ? ' Se omitieron ' + errors + ' pares con geometrías no válidas.' : ''));
  } catch (error) {
    console.error('No se pudo calcular la superposición:', error);
    registrarErrorAnalisis('Superposición espacial (intersect)', error.message, names, {});
    avisarAnalisis(error.message || 'No se pudo calcular la superposición.', true);
  } finally { button.disabled = false; }
});

document.getElementById('runAccessibility').addEventListener('click', async function () {
  var button = this;
  button.disabled = true;
  try {
    avisarAnalisis('Preparando el análisis de proximidad…');
    await asegurarTurf();
    var name = document.getElementById('accessLayer').value;
    var distance = Number(document.getElementById('accessDistance').value);
    var unit = document.getElementById('accessUnit').value;
    if (!Number.isFinite(distance) || distance <= 0) throw new Error('Introduce una distancia mayor que cero.');
    var input = await cargarFuncionesLayer(name);
    if (!input.features.length) throw new Error('La capa seleccionada no contiene geometrías.');
    if (input.features.length > 10000) throw new Error('La capa supera las 10.000 entidades; el análisis de proximidad está limitado para conservar el rendimiento.');
    var buffered = [];
    var errors = 0;
    for (var i = 0; i < input.features.length; i += 1) {
      try {
        var result = turf.buffer(input.features[i], distance, { units: unit, steps: 8 });
        if (result && result.geometry) {
          result.properties = Object.assign({}, input.features[i].properties || {}, {
            entidad_origen: i + 1,
            distancia_proximidad: distance,
            unidad_proximidad: unit
          });
          buffered.push(result);
        }
      } catch (geometryError) { errors += 1; }
      if ((i + 1) % 100 === 0) {
        avisarAnalisis('Calculando zonas: ' + (i + 1) + ' de ' + input.features.length + ' destinos…');
        await yieldToBrowser();
      }
    }
    if (!buffered.length) throw new Error('No fue posible crear zonas de proximidad con esas geometrías.');
    var resultName = crearCapaResultado('Proximidad de ' + name + ' ' + distance + ' ' + unit, buffered);
    registrarOperacion({
      tool: 'Proximidad en línea recta',
      inputs: [referenciaCapa(name, input.features)],
      outputName: resultName,
      outputSummary: resumirEntidades(buffered),
      procedure: 'Se generaron zonas de influencia alrededor de las geometrías de la capa de destinos.',
      processedCount: input.features.length,
      parameters: { distancia: distance, unidad: etiquetaUnidadDistancia(unit), segmentosPorBuffer: 8 },
      result: {
        metrics: {
          zonasGeneradas: buffered.length,
          superficieTotalPorZona: resumirEntidades(buffered).polygonAreaM2 === null
            ? 'No calculada'
            : reportNumberFormat.format(resumirEntidades(buffered).polygonAreaM2 / 10000) + ' ha (suma por zona)'
        }
      },
      warnings: errors ? [errors + ' geometrías no válidas fueron omitidas.'] : [],
      interpretation: 'Las zonas delimitan proximidad geométrica en línea recta a la distancia indicada; no representan rutas, tiempos de viaje ni una afectación legal o predial.'
    });
    avisarAnalisis('Se crearon ' + buffered.length + ' zonas de proximidad en «' + resultName + '». Distancia en línea recta; no representa rutas.' + (errors ? ' Se omitieron ' + errors + ' geometrías inválidas.' : ''));
  } catch (error) {
    console.error('No se pudo calcular la proximidad:', error);
    registrarErrorAnalisis('Proximidad en línea recta', error.message, [name], { distancia: distance, unidad: unit });
    avisarAnalisis(error.message || 'No se pudo calcular la proximidad.', true);
  } finally { button.disabled = false; }
});

document.getElementById('runHeatmap').addEventListener('click', async function () {
  var button = this;
  button.disabled = true;
  try {
    avisarAnalisis('Preparando el mapa de concentración…');
    await asegurarTurf();
    var name = document.getElementById('heatLayer').value;
    var field = document.getElementById('heatField').value;
    var cellSize = Number(document.getElementById('heatCellSize').value);
    var input = await cargarFuncionesLayer(name);
    if (!input.features.length) throw new Error('La capa seleccionada no contiene geometrías.');
    if (input.features.length > 5000) throw new Error('La capa tiene más de 5.000 entidades; el mapa de concentración está limitado para conservar el rendimiento.');
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Elige un tamaño de celda válido.');
    var weights = input.features.map(function (feature) {
      return field ? Number(feature.properties && feature.properties[field]) : 1;
    });
    if (weights.some(function (weight) { return !Number.isFinite(weight) || weight < 0; })) throw new Error('El campo de ponderación debe tener valores numéricos iguales o mayores que cero.');
    var centroids = [];
    var skipped = 0;
    input.features.forEach(function (feature, index) {
      try {
        var centroid = turf.centroid(feature);
        if (centroid && centroid.geometry) centroids.push({ point: centroid, index: index });
        else skipped += 1;
      } catch (geometryError) { skipped += 1; }
    });
    if (!centroids.length) throw new Error('No se pudieron calcular centroides para las geometrías seleccionadas.');
    var meanLatitude = centroids.reduce(function (sum, item) {
      return sum + item.point.geometry.coordinates[1];
    }, 0) / centroids.length;
    var cellLatitude = cellSize / 111320;
    var cellLongitude = cellSize / (111320 * Math.max(.1, Math.cos(meanLatitude * Math.PI / 180)));
    var cells = new Map();
    centroids.forEach(function (item) {
      var point = item.point;
      var x = Math.floor(point.geometry.coordinates[0] / cellLongitude);
      var y = Math.floor(point.geometry.coordinates[1] / cellLatitude);
      var key = x + ':' + y;
      var cell = cells.get(key);
      if (!cell) {
        cell = { x: x, y: y, count: 0, weight: 0 };
        cells.set(key, cell);
      }
      cell.count += 1;
      cell.weight += weights[item.index];
    });
    var cellFeatures = Array.from(cells.values());
    var sortedConcentrations = cellFeatures.map(function (cell) { return field ? cell.weight : cell.count; }).sort(function (a, b) { return a - b; });
    var concentrationThresholds = Array.from({ length: 6 }, function (_, index) {
      return sortedConcentrations[Math.floor((sortedConcentrations.length - 1) * (index + 1) / 6)];
    });
    var concentrationColors = ['#fff7bc', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404'];
    var polygons = cellFeatures.map(function (cell) {
      var west = cell.x * cellLongitude;
      var south = cell.y * cellLatitude;
      var east = west + cellLongitude;
      var north = south + cellLatitude;
      var value = field ? cell.weight : cell.count;
      var level = concentrationThresholds.findIndex(function (threshold) { return value <= threshold; });
      if (level < 0) level = concentrationColors.length - 1;
      return {
        type: 'Feature',
        properties: {
          entidades: cell.count,
          valor_concentracion: Math.round(value * 100) / 100,
          criterio: field || 'conteo de entidades',
          tamano_celda_m: cellSize,
          _heatColor: concentrationColors[level]
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
        }
      };
    });
    var resultName = crearCapaResultado('Concentración ' + cellSize + ' m de ' + name, polygons);
    var totalWeight = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
    var topCells = polygons.slice().sort(function (a, b) {
      return b.properties.valor_concentracion - a.properties.valor_concentracion;
    }).slice(0, 20);
    registrarOperacion({
      tool: 'Concentración espacial por celdas',
      inputs: [referenciaCapa(name, input.features)],
      outputName: resultName,
      outputSummary: resumirEntidades(polygons),
      procedure: 'Se calcularon centroides de las entidades y se agregaron por celdas regulares; cada celda resume conteos o la suma del campo seleccionado.',
      processedCount: input.features.length,
      parameters: { tamañoCelda: cellSize, unidad: 'm', campoPonderación: field || 'conteo de entidades' },
      result: {
        metrics: {
          celdasGeneradas: polygons.length,
          entidadesAgregadas: centroids.length,
          registrosOmitidos: skipped,
          sumaDePonderaciones: field ? reportNumberFormat.format(totalWeight) : 'No aplica (conteo)'
        },
        rows: topCells.map(function (feature) {
          var properties = feature.properties;
          var ring = feature.geometry.coordinates[0];
          var centerLongitude = (ring[0][0] + ring[2][0]) / 2;
          var centerLatitude = (ring[0][1] + ring[2][1]) / 2;
          return [
            reportNumberFormat.format(centerLatitude) + ', ' + reportNumberFormat.format(centerLongitude),
            String(properties.entidades),
            reportNumberFormat.format(properties.valor_concentracion)
          ];
        }),
        rowHeadings: ['Centro de celda (lat, lon)', 'Entidades', field ? 'Suma de ' + field : 'Conteo']
      },
      warnings: skipped ? [skipped + ' geometrías no pudieron convertirse en centroides.'] : [],
      interpretation: 'Las celdas muestran la distribución espacial del conteo' +
        (field ? ' y la suma del atributo «' + field + '»' : '') +
        ' a la escala de ' + cellSize + ' m. La agregación por centroide no equivale a sumar superficies ni a una estimación de población.'
    });
    avisarAnalisis('Se generaron ' + polygons.length + ' celdas de concentración de ' + cellSize + ' m en «' + resultName + '».' + (field ? ' Los colores representan la suma de «' + field + '».' : ' Los colores representan el conteo de entidades.') + (skipped ? ' Se omitieron ' + skipped + ' geometrías inválidas.' : ''));
  } catch (error) {
    console.error('No se pudo generar el mapa de concentración:', error);
    registrarErrorAnalisis('Concentración espacial por celdas', error.message, [name], { campoPonderación: field, tamañoCelda: cellSize, unidad: 'm' });
    avisarAnalisis(error.message || 'No se pudo generar el mapa de concentración.', true);
  } finally { button.disabled = false; }
});

var chartPalettes = {
  ocean: ['#005A8D', '#E69F00', '#00856A', '#C43C39', '#7A5195', '#48A9C5', '#9C6B30', '#D45087', '#4B6F44', '#6C4C41', '#5369A8', '#A0A500'],
  vibrant: ['#D81B60', '#1E88E5', '#FFC107', '#004D40', '#8E24AA', '#43A047', '#F4511E', '#3949AB', '#7CB342', '#6D4C41', '#00ACC1', '#C0CA33'],
  earth: ['#007F5F', '#D1495B', '#457B9D', '#E09F3E', '#6A4C93', '#2A9D8F', '#BC4749', '#577590', '#9C6644', '#386641', '#F3722C', '#5A189A'],
  warm: ['#B2182B', '#2166AC', '#EF8A17', '#4D9221', '#762A83', '#00A6A6', '#E7298A', '#7F7F00', '#5E3C99', '#D95F02', '#1B9E77', '#666666']
};
var graficoEstadisticoActual = null;
var svgNamespace = 'http://www.w3.org/2000/svg';

function crearSvgElemento(tagName, attributes, text) {
  var element = document.createElementNS(svgNamespace, tagName);
  Object.keys(attributes || {}).forEach(function (name) {
    element.setAttribute(name, attributes[name]);
  });
  if (text !== undefined) element.textContent = text;
  return element;
}

function hacerMarcaGraficoInteractiva(element, group, index, total) {
  var percentage = group.count / total * 100;
  var label = group.label + ': ' + group.count.toLocaleString('es-CO') + ' registros, ' +
    percentage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%';
  element.setAttribute('data-chart-index', index);
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', label);
  element.appendChild(crearSvgElemento('title', {}, label));
}

function crearSvgGrafico(groups, type, colors) {
  var width = 360;
  var height = type === 'bar' || type === 'table' ? Math.max(130, groups.length * 30 + 42) : 230;
  var svg = crearSvgElemento('svg', {
    xmlns: svgNamespace,
    viewBox: '0 0 ' + width + ' ' + height,
    role: 'group',
    'aria-label': 'Gráfico estadístico de ' + groups.length + ' grupos'
  });
  svg.appendChild(crearSvgElemento('title', {}, 'Distribución estadística'));
  svg.appendChild(crearSvgElemento('rect', { x: 0, y: 0, width: width, height: height, fill: '#ffffff' }));
  var total = groups.reduce(function (sum, group) { return sum + group.count; }, 0);

  if (type === 'table') {
    svg.appendChild(crearSvgElemento('rect', { x: 8, y: 8, width: 344, height: 24, rx: 4, fill: '#edf4f8' }));
    svg.appendChild(crearSvgElemento('text', { x: 18, y: 24, fill: '#344b62', 'font-size': 10, 'font-weight': 700 }, 'Categoría o intervalo'));
    svg.appendChild(crearSvgElemento('text', { x: 265, y: 24, 'text-anchor': 'end', fill: '#344b62', 'font-size': 10, 'font-weight': 700 }, 'Frecuencia'));
    svg.appendChild(crearSvgElemento('text', { x: 338, y: 24, 'text-anchor': 'end', fill: '#344b62', 'font-size': 10, 'font-weight': 700 }, '%'));
    groups.forEach(function (group, index) {
      var y = 36 + index * 30;
      var percentage = group.count / total * 100;
      var label = group.label.length > 27 ? group.label.slice(0, 26) + '…' : group.label;
      svg.appendChild(crearSvgElemento('line', { x1: 8, y1: y + 26, x2: 352, y2: y + 26, stroke: '#e8eef3' }));
      var swatch = crearSvgElemento('rect', { x: 14, y: y + 6, width: 9, height: 9, rx: 2, fill: colors[index % colors.length] });
      hacerMarcaGraficoInteractiva(swatch, group, index, total);
      svg.appendChild(swatch);
      svg.appendChild(crearSvgElemento('text', { x: 30, y: y + 15, fill: '#52677c', 'font-size': 10 }, label));
      svg.appendChild(crearSvgElemento('text', { x: 265, y: y + 15, 'text-anchor': 'end', fill: '#344b62', 'font-size': 10 }, group.count.toLocaleString('es-CO')));
      svg.appendChild(crearSvgElemento('text', { x: 338, y: y + 15, 'text-anchor': 'end', fill: '#344b62', 'font-size': 10 }, percentage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%'));
    });
    return svg;
  }

  if (type === 'pie') {
    var centerX = 180;
    var centerY = 112;
    var radius = 84;
    var angle = -Math.PI / 2;
    groups.forEach(function (group, index) {
      if (!group.count) return;
      var nextAngle = angle + group.count / total * Math.PI * 2;
      var color = colors[index % colors.length];
      if (group.count === total) {
        var fullSlice = crearSvgElemento('circle', {
          cx: centerX, cy: centerY, r: radius, fill: color, stroke: '#ffffff', 'stroke-width': 3
        });
        hacerMarcaGraficoInteractiva(fullSlice, group, index, total);
        svg.appendChild(fullSlice);
      } else {
        var startX = centerX + radius * Math.cos(angle);
        var startY = centerY + radius * Math.sin(angle);
        var endX = centerX + radius * Math.cos(nextAngle);
        var endY = centerY + radius * Math.sin(nextAngle);
        var largeArc = nextAngle - angle > Math.PI ? 1 : 0;
        var path = 'M ' + centerX + ' ' + centerY + ' L ' + startX + ' ' + startY +
          ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + endX + ' ' + endY + ' Z';
        var slice = crearSvgElemento('path', {
          d: path, fill: color, stroke: '#ffffff', 'stroke-width': 3
        });
        hacerMarcaGraficoInteractiva(slice, group, index, total);
        svg.appendChild(slice);
      }
      angle = nextAngle;
    });
    return svg;
  }

  if (type === 'bar') {
    var left = 104;
    var plotWidth = 188;
    var rowHeight = 30;
    var maxCount = Math.max.apply(Math, groups.map(function (group) { return group.count; }).concat([1]));
    [0, 0.5, 1].forEach(function (fraction) {
      var x = left + fraction * plotWidth;
      svg.appendChild(crearSvgElemento('line', {
        x1: x, y1: 10, x2: x, y2: height - 12, stroke: '#e8eef3', 'stroke-width': 1
      }));
      svg.appendChild(crearSvgElemento('text', {
        x: x, y: height - 1, 'text-anchor': 'middle', fill: '#75869a', 'font-size': 9
      }, Math.round(maxCount * fraction).toLocaleString('es-CO')));
    });
    groups.forEach(function (group, index) {
      var y = 12 + index * rowHeight;
      var percentage = group.count / total * 100;
      var label = group.label.length > 17 ? group.label.slice(0, 16) + '…' : group.label;
      svg.appendChild(crearSvgElemento('text', {
        x: left - 8, y: y + 13, 'text-anchor': 'end', fill: '#52677c', 'font-size': 10
      }, label));
      svg.appendChild(crearSvgElemento('rect', {
        x: left, y: y + 3, width: plotWidth, height: 14, rx: 5, fill: '#edf3f7'
      }));
      var bar = crearSvgElemento('rect', {
        x: left, y: y + 3, width: Math.max(group.count ? 2 : 0, group.count / maxCount * plotWidth), height: 14, rx: 5,
        fill: colors[index % colors.length], stroke: '#ffffff', 'stroke-width': 1
      });
      hacerMarcaGraficoInteractiva(bar, group, index, total);
      svg.appendChild(bar);
      svg.appendChild(crearSvgElemento('text', {
        x: left + plotWidth + 7, y: y + 13, fill: '#344b62', 'font-size': 9
      }, percentage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%'));
    });
    return svg;
  }

  var chartLeft = 34;
  var chartTop = 18;
  var chartWidth = 310;
  var chartHeight = 150;
  var maxValue = Math.max.apply(Math, groups.map(function (group) { return group.count; }).concat([1]));
  [0, 0.5, 1].forEach(function (fraction) {
    var y = chartTop + chartHeight * (1 - fraction);
    svg.appendChild(crearSvgElemento('line', {
      x1: chartLeft, y1: y, x2: chartLeft + chartWidth, y2: y, stroke: '#e8eef3', 'stroke-width': 1
    }));
    svg.appendChild(crearSvgElemento('text', {
      x: chartLeft - 5, y: y + 3, 'text-anchor': 'end', fill: '#75869a', 'font-size': 9
    }, Math.round(maxValue * fraction).toLocaleString('es-CO')));
  });
  var slotWidth = chartWidth / groups.length;
  var barWidth = Math.min(34, slotWidth * 0.58);
  groups.forEach(function (group, index) {
    var x = chartLeft + index * slotWidth + (slotWidth - barWidth) / 2;
    var barHeight = group.count / maxValue * chartHeight;
    var label = group.label.length > 9 ? group.label.slice(0, 8) + '…' : group.label;
    var column = crearSvgElemento('rect', {
      x: x, y: chartTop + chartHeight - barHeight, width: barWidth, height: barHeight,
      rx: Math.min(4, barWidth / 4), fill: colors[index % colors.length], stroke: '#ffffff', 'stroke-width': 1
    });
    hacerMarcaGraficoInteractiva(column, group, index, total);
    svg.appendChild(column);
    svg.appendChild(crearSvgElemento('text', {
      x: x + barWidth / 2, y: chartTop + chartHeight + 16, 'text-anchor': 'middle', fill: '#52677c', 'font-size': 8
    }, label));
  });
  return svg;
}

function descargarArchivo(nombre, contenido, tipo) {
  var url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  var link = document.createElement('a');
  link.href = url;
  link.download = nombre;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function mostrarDetalleGrafico(index) {
  if (!graficoEstadisticoActual || !graficoEstadisticoActual.groups[index]) return;
  var group = graficoEstadisticoActual.groups[index];
  var percentage = group.count / graficoEstadisticoActual.total * 100;
  var output = document.getElementById('chartOutput');
  var detail = output.querySelector('.chart-selection-feedback');
  if (!detail) {
    detail = document.createElement('p');
    detail.className = 'chart-selection-feedback';
    detail.setAttribute('role', 'status');
    detail.setAttribute('aria-live', 'polite');
    output.appendChild(detail);
  }
  detail.textContent = group.label + ' · ' + group.count.toLocaleString('es-CO') +
    (group.count === 1 ? ' registro · ' : ' registros · ') +
    percentage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '% del total';
}

var chartOutput = document.getElementById('chartOutput');
chartOutput.addEventListener('click', function (event) {
  var target = event.target.closest('[data-chart-index]');
  if (target && chartOutput.contains(target)) mostrarDetalleGrafico(Number(target.getAttribute('data-chart-index')));
});
chartOutput.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  var target = event.target.closest('[data-chart-index]');
  if (!target || !chartOutput.contains(target)) return;
  event.preventDefault();
  mostrarDetalleGrafico(Number(target.getAttribute('data-chart-index')));
});

document.getElementById('runChart').addEventListener('click', async function () {
  var button = this;
  button.disabled = true;
  try {
    var name = document.getElementById('chartLayer').value;
    var field = document.getElementById('chartField').value;
    var chartType = document.getElementById('chartType').value;
    var paletteName = document.getElementById('chartPalette').value;
    var colors = chartPalettes[paletteName] || chartPalettes.ocean;
    if (!field) throw new Error('Selecciona un campo para graficar.');
    var input = await cargarFuncionesLayer(name);
    var rawValues = input.features.map(function (feature) {
      return feature.properties && feature.properties[field];
    });
    var values = rawValues.filter(function (value) {
      return value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
    });
    if (!values.length) throw new Error('No hay valores disponibles para ese campo.');
    var numeric = values.every(function (value) { return Number.isFinite(Number(value)); });
    var groups = [];
    var numbers = [];
    var categoryCount = 0;
    var omittedCategories = false;
    if (numeric) {
      numbers = values.map(Number).sort(function (a, b) { return a - b; });
      var min = numbers[0];
      var max = numbers[numbers.length - 1];
      var count = min === max ? 1 : 5;
      for (var i = 0; i < count; i += 1) {
        var lower = min + (max - min) * i / count;
        var upper = i === count - 1 ? max : min + (max - min) * (i + 1) / count;
        var tally = numbers.filter(function (number) {
          return number >= lower && (number < upper || i === count - 1 && number <= upper);
        }).length;
        groups.push({ label: lower === upper ? String(lower) : lower.toLocaleString('es-CO', { maximumFractionDigits: 2 }) + '–' + upper.toLocaleString('es-CO', { maximumFractionDigits: 2 }), count: tally });
      }
    } else {
      var counts = new Map();
      values.forEach(function (value) {
        var label = String(value);
        counts.set(label, (counts.get(label) || 0) + 1);
      });
      groups = Array.from(counts.entries()).map(function (entry) { return { label: entry[0], count: entry[1] }; })
        .sort(function (a, b) { return b.count - a.count; });
      categoryCount = groups.length;
      if (groups.length > 12) {
        var omitted = groups.slice(11).reduce(function (sum, group) { return sum + group.count; }, 0);
        groups = groups.slice(0, 11);
        groups.push({ label: 'Otras categorías', count: omitted });
        omittedCategories = true;
      }
    }
    var output = document.getElementById('chartOutput');
    output.replaceChildren();
    var heading = document.createElement('div');
    heading.className = 'chart-heading';
    var title = document.createElement('strong');
    title.textContent = field;
    var subtitle = document.createElement('span');
    var chartTypeLabels = { bar: 'Barras horizontales', column: 'Columnas', pie: 'Torta', table: 'Tabla' };
    subtitle.textContent = name + ' · ' + (numeric ? 'distribución numérica' : 'distribución por categoría') +
      ' · ' + chartTypeLabels[chartType];
    heading.append(title, subtitle);
    output.appendChild(heading);

    var missingCount = rawValues.length - values.length;
    var coverage = rawValues.length ? values.length / rawValues.length * 100 : 0;
    var stats = document.createElement('div');
    stats.className = 'chart-stats';
    var statItems = numeric ? [
      { label: 'Registros', value: values.length.toLocaleString('es-CO') },
      { label: 'Promedio', value: (numbers.reduce(function (sum, number) { return sum + number; }, 0) / numbers.length).toLocaleString('es-CO', { maximumFractionDigits: 2 }) },
      { label: 'Mediana', value: (numbers.length % 2 ? numbers[Math.floor(numbers.length / 2)] : (numbers[numbers.length / 2 - 1] + numbers[numbers.length / 2]) / 2).toLocaleString('es-CO', { maximumFractionDigits: 2 }) },
      { label: 'Mínimo', value: numbers[0].toLocaleString('es-CO', { maximumFractionDigits: 2 }) },
      { label: 'Máximo', value: numbers[numbers.length - 1].toLocaleString('es-CO', { maximumFractionDigits: 2 }) },
      { label: 'Rango', value: (numbers[numbers.length - 1] - numbers[0]).toLocaleString('es-CO', { maximumFractionDigits: 2 }) }
    ] : [
      { label: 'Registros', value: values.length.toLocaleString('es-CO') },
      { label: 'Categorías', value: categoryCount.toLocaleString('es-CO') },
      { label: 'Más frecuente', value: groups[0].label },
      { label: 'Frecuencia mayor', value: groups[0].count.toLocaleString('es-CO') }
    ];
    statItems.forEach(function (item) {
      var stat = document.createElement('div');
      stat.className = 'chart-stat';
      var statValue = document.createElement('strong');
      statValue.textContent = item.value;
      var statLabel = document.createElement('span');
      statLabel.textContent = item.label;
      stat.append(statValue, statLabel);
      stats.appendChild(stat);
    });
    output.appendChild(stats);

    var quality = document.createElement('div');
    quality.className = 'chart-quality';
    var qualityText = document.createElement('span');
    qualityText.textContent = 'Cobertura del campo';
    var qualityValue = document.createElement('strong');
    qualityValue.textContent = coverage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '% · ' +
      missingCount.toLocaleString('es-CO') + ' sin dato';
    var qualityTrack = document.createElement('span');
    qualityTrack.className = 'chart-quality-track';
    var qualityBar = document.createElement('span');
    qualityBar.className = 'chart-quality-bar';
    qualityBar.style.width = coverage + '%';
    qualityTrack.appendChild(qualityBar);
    quality.append(qualityText, qualityValue, qualityTrack);
    output.appendChild(quality);

    var visual = document.createElement('div');
    visual.className = 'chart-visual';
    var svg = crearSvgGrafico(groups, chartType, colors);
    if (chartType === 'table') {
      var table = document.createElement('table');
      table.className = 'chart-data-table';
      var caption = document.createElement('caption');
      caption.className = 'visually-hidden';
      caption.textContent = 'Frecuencia y porcentaje por categoría o intervalo';
      table.appendChild(caption);
      var tableHead = document.createElement('thead');
      var headerRow = document.createElement('tr');
      ['Categoría o intervalo', 'Frecuencia', 'Porcentaje'].forEach(function (headingText) {
        var cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = headingText;
        headerRow.appendChild(cell);
      });
      tableHead.appendChild(headerRow);
      table.appendChild(tableHead);
      var tableBody = document.createElement('tbody');
      groups.forEach(function (group, index) {
        var row = document.createElement('tr');
        row.setAttribute('data-chart-index', index);
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-label', group.label + ': ' + group.count.toLocaleString('es-CO') + ' registros');
        var labelCell = document.createElement('th');
        labelCell.scope = 'row';
        var swatch = document.createElement('span');
        swatch.className = 'chart-key-swatch';
        swatch.style.backgroundColor = colors[index % colors.length];
        var label = document.createElement('span');
        label.textContent = group.label;
        labelCell.append(swatch, label);
        var countCell = document.createElement('td');
        countCell.textContent = group.count.toLocaleString('es-CO');
        var percentageCell = document.createElement('td');
        percentageCell.textContent = (group.count / values.length * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%';
        row.append(labelCell, countCell, percentageCell);
        tableBody.appendChild(row);
      });
      table.appendChild(tableBody);
      visual.appendChild(table);
    } else {
      visual.appendChild(svg);
    }
    output.appendChild(visual);

    var leadingIndex = groups.reduce(function (bestIndex, group, index) {
      return group.count > groups[bestIndex].count ? index : bestIndex;
    }, 0);
    if (chartType !== 'table') groups.forEach(function (group, index) {
      var row = document.createElement('div');
      row.className = 'chart-row';
      row.setAttribute('data-chart-index', index);
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'button');
      if (index === leadingIndex) row.classList.add('chart-row-leading');
      var swatch = document.createElement('span');
      swatch.className = 'chart-key-swatch';
      swatch.style.backgroundColor = colors[index % colors.length];
      var label = document.createElement('span');
      label.className = 'chart-label';
      label.textContent = group.label;
      label.title = group.label;
      var percentage = group.count / values.length * 100;
      row.title = group.label + ': ' + group.count.toLocaleString('es-CO') + ' registros (' +
        percentage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%)';
      var valuesCell = document.createElement('span');
      valuesCell.className = 'chart-values';
      var count = document.createElement('strong');
      count.textContent = group.count.toLocaleString('es-CO');
      var share = document.createElement('span');
      share.textContent = (group.count / values.length * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%';
      valuesCell.append(count, share);
      row.append(swatch, label, valuesCell);
      output.appendChild(row);
    });
    var summary = document.createElement('p');
    summary.className = 'chart-summary';
    summary.textContent = (numeric ? (groups.length === 1 ? 'Un único valor numérico' : 'Intervalos de igual amplitud') : 'Frecuencia por categoría') +
      (omittedCategories ? ' · Se muestran las 11 categorías principales y el resto agrupado' : '') +
      ' · Las proporciones se calculan sobre los registros con dato.';
    output.appendChild(summary);
    graficoEstadisticoActual = {
      svg: svg,
      groups: groups,
      total: values.length,
      name: name,
      field: field,
      type: chartType,
      palette: paletteName,
      stats: statItems,
      numeric: numeric
    };
    var chartMetrics = {};
    statItems.forEach(function (item) { chartMetrics[item.label] = item.value; });
    chartMetrics.registrosSinDato = missingCount;
    chartMetrics.coberturaDelCampo = coverage.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%';
    registrarOperacion({
      tool: 'Resumen estadístico de atributos',
      inputs: [referenciaCapa(name, input.features)],
      procedure: 'Se resumió la distribución del campo «' + field + '» y se generó una visualización estadística.',
      processedCount: input.features.length,
      parameters: { campo: field, tipoGráfico: chartType, paleta: paletteName },
      result: {
        metrics: chartMetrics,
        rows: groups.map(function (group) {
          return [
            group.label,
            group.count.toLocaleString('es-CO'),
            (group.count / values.length * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%'
          ];
        }),
        rowHeadings: ['Categoría o intervalo', 'Frecuencia', 'Porcentaje']
      },
      interpretation: (numeric
        ? 'La distribución numérica muestra ' + values.length + ' registros válidos, con promedio ' + chartMetrics.Promedio + ' y rango de ' + chartMetrics.Rango + '.'
        : 'La categoría más frecuente es «' + groups[0].label + '» con ' + groups[0].count + ' registros de ' + values.length + '.') +
        ' El resumen describe únicamente los valores disponibles en el atributo; no implica causalidad territorial.'
    });
    document.getElementById('chartDownloads').hidden = false;
    avisarAnalisis('Gráfico generado con ' + values.length + ' registros.');
  } catch (error) {
    console.error('No se pudo generar el gráfico:', error);
    registrarErrorAnalisis('Resumen estadístico de atributos', error.message, [name], { campo: field, tipoGráfico: chartType });
    avisarAnalisis(error.message || 'No se pudo generar el gráfico.', true);
  } finally { button.disabled = false; }
});

function nombreArchivoGrafico(extension) {
  var sourceName = graficoEstadisticoActual.name + '-' + graficoEstadisticoActual.field;
  var safeName = sourceName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return (safeName || 'grafico-estadistico') + '.' + extension;
}

document.getElementById('downloadChartSvg').addEventListener('click', function () {
  if (!graficoEstadisticoActual) return;
  try {
    var svgText = new XMLSerializer().serializeToString(graficoEstadisticoActual.svg);
    descargarArchivo(nombreArchivoGrafico('svg'), svgText, 'image/svg+xml;charset=utf-8');
  } catch (error) {
    console.error('No se pudo exportar el gráfico SVG:', error);
    avisarAnalisis('No se pudo descargar el gráfico en SVG.', true);
  }
});

document.getElementById('downloadChartPng').addEventListener('click', function () {
  if (!graficoEstadisticoActual) return;
  var button = this;
  button.disabled = true;
  try {
    var svgClone = graficoEstadisticoActual.svg.cloneNode(true);
    var viewBox = svgClone.viewBox.baseVal;
    var scale = 3;
    svgClone.setAttribute('width', viewBox.width * scale);
    svgClone.setAttribute('height', viewBox.height * scale);
    var svgBlob = new Blob([new XMLSerializer().serializeToString(svgClone)], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(svgBlob);
    var image = new Image();
    image.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = viewBox.width * scale;
        canvas.height = viewBox.height * scale;
        var context = canvas.getContext('2d');
        if (!context) throw new Error('El navegador no pudo preparar el lienzo de exportación.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (pngBlob) {
          URL.revokeObjectURL(url);
          button.disabled = false;
          if (!pngBlob) {
            avisarAnalisis('No se pudo convertir el gráfico a PNG.', true);
            return;
          }
          descargarArchivo(nombreArchivoGrafico('png'), pngBlob, 'image/png');
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(url);
        button.disabled = false;
        console.error('No se pudo exportar el gráfico PNG:', error);
        avisarAnalisis(error.message || 'No se pudo descargar el gráfico en PNG.', true);
      }
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      button.disabled = false;
      avisarAnalisis('El navegador no pudo convertir el gráfico a PNG.', true);
    };
    image.src = url;
  } catch (error) {
    button.disabled = false;
    console.error('No se pudo exportar el gráfico PNG:', error);
    avisarAnalisis(error.message || 'No se pudo descargar el gráfico en PNG.', true);
  }
});

document.getElementById('downloadChartCsv').addEventListener('click', function () {
  if (!graficoEstadisticoActual) return;
  try {
    var data = graficoEstadisticoActual;
    var rows = [
      ['Capa', data.name],
      ['Campo', data.field],
      ['Tipo de gráfico', data.type],
      ['Paleta', data.palette],
      ['Total de registros con dato', data.total],
      [],
      ['Estadística', 'Valor']
    ];
    data.stats.forEach(function (item) { rows.push([item.label, item.value]); });
    rows.push([], ['Categoría o intervalo', 'Frecuencia', 'Porcentaje']);
    data.groups.forEach(function (group) {
      rows.push([
        group.label,
        group.count,
        (group.count / data.total * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%'
      ]);
    });
    var csv = '\uFEFF' + rows.map(function (row) {
      return row.map(function (value) {
        return '"' + String(value === undefined || value === null ? '' : value).replace(/"/g, '""') + '"';
      }).join(';');
    }).join('\r\n');
    descargarArchivo(nombreArchivoGrafico('csv'), csv, 'text/csv;charset=utf-8');
  } catch (error) {
    console.error('No se pudo exportar el resumen CSV:', error);
    avisarAnalisis('No se pudo descargar el resumen en CSV.', true);
  }
});

[
  { layer: 'heatLayer', field: 'heatField', empty: true },
  { layer: 'chartLayer', field: 'chartField', empty: false }
].forEach(function (configuration) {
  var select = document.getElementById(configuration.layer);
  select.addEventListener('change', async function () {
    try {
      avisarAnalisis('Cargando atributos de «' + this.value + '»…');
      await asegurarCargaCapa(capas[this.value]);
      llenarCamposDeCapa(this.value, configuration.field, configuration.empty);
      avisarAnalisis('Capa lista para analizar.');
    } catch (error) {
      avisarAnalisis(error.message || 'No se pudieron cargar los campos de esa capa.', true);
    }
  });
});

document.getElementById('runBuffer').addEventListener('click', async function () {
  var runButton = this; runButton.disabled = true;
  try {
    avisarAnalisis('Preparando el motor de análisis…');
    await asegurarTurf();
    var name = document.getElementById('bufferLayer').value;
    var targetName = document.getElementById('bufferTargetLayer').value;
    var distance = Number(document.getElementById('bufferDistance').value);
    var unit = document.getElementById('bufferUnit').value;
    if (!name || !Number.isFinite(distance) || distance <= 0) throw new Error('Selecciona una capa e introduce una distancia mayor que cero.');
    avisarAnalisis('Cargando entidades y calculando áreas de influencia…');
    var source = await asegurarCargaCapa(capas[name]);
    var input = source._attributeFeatures || [];
    if (!input.length) throw new Error('La capa seleccionada no contiene entidades.');
    var buffered = [];
    var erroresGeometria = 0;
    for (var start = 0; start < input.length; start += 100) {
      var lote = input.slice(start, start + 100);
      lote.forEach(function (feature, loteIndex) {
        try {
          if (!feature.geometry) return;
          var result = turf.buffer(feature, distance, { units: unit, steps: 8 });
          if (!result) return;
          result.properties = Object.assign({}, feature.properties || {}, { buffer_origen: start + loteIndex + 1, distancia_buffer: distance, unidad_buffer: unit, area_m2: Math.round(areaFeature(result.geometry) * 100) / 100 });
          buffered.push(result);
        } catch (geometryError) { erroresGeometria += 1; }
      });
      avisarAnalisis('Calculando áreas de influencia: ' + Math.min(start + lote.length, input.length) + ' de ' + input.length + ' entidades…');
      await yieldToBrowser();
    }
    if (!buffered.length) throw new Error('No se generaron polígonos. Comprueba que la capa tenga geometrías válidas.');
    if (document.getElementById('bufferDissolve').value === 'dissolve') {
      var dissolved = buffered.length === 1 ? buffered[0] : turf.union(turf.featureCollection(buffered));
      if (!dissolved) throw new Error('No fue posible unir las áreas de influencia.');
      dissolved.properties = { entidades_origen: buffered.length, distancia_buffer: distance, unidad_buffer: unit, area_m2: Math.round(areaFeature(dissolved.geometry) * 100) / 100 };
      buffered = [dissolved];
    }
    var affectedEntities = [];
    var targetFeatures = [];
    var targetSummaryAvailable = false;
    var comparisonGeometryErrors = 0;
    var comparisonWarnings = [];
    if (targetName) {
      try {
        avisarAnalisis('Identificando entidades de «' + targetName + '» dentro de las áreas de influencia…');
        var targetInput = await cargarFuncionesLayer(targetName);
        targetFeatures = targetInput.features;
        targetSummaryAvailable = true;
        if (buffered.length * targetFeatures.length > 250000) {
          comparisonWarnings.push('El cruce con «' + targetName + '» excedió 250.000 pares posibles; no se calcularon entidades coincidentes.');
        } else {
          var bufferBoxes = buffered.map(cajaGeometria);
          targetFeatures.forEach(function (feature, featureIndex) {
            var featureBox = cajaGeometria(feature);
            for (var bufferIndex = 0; bufferIndex < buffered.length; bufferIndex += 1) {
              if (!cajasSeCruzan(featureBox, bufferBoxes[bufferIndex])) continue;
              try {
                if (turf.booleanIntersects(feature, buffered[bufferIndex])) {
                  affectedEntities.push({ feature: feature, index: featureIndex });
                  break;
                }
              } catch (geometryError) {
                comparisonGeometryErrors += 1;
                break;
              }
            }
          });
          if (comparisonGeometryErrors) comparisonWarnings.push(comparisonGeometryErrors + ' geometrías de «' + targetName + '» no pudieron validarse.');
        }
      } catch (comparisonError) {
        comparisonWarnings.push('No se pudo evaluar la capa «' + targetName + '»: ' + comparisonError.message);
      }
    }
    var resultName = crearCapaResultado('Área de influencia de ' + name, buffered);
    var bufferSummary = resumirEntidades(buffered);
    var dissolveMode = document.getElementById('bufferDissolve').value;
    var bufferInputs = [referenciaCapa(name, input)];
    if (targetName) bufferInputs.push(targetSummaryAvailable ? referenciaCapa(targetName, targetFeatures) : { name: targetName });
    var affectedNames = affectedEntities.slice(0, 100).map(function (item) {
      return nombreCampoIdentificador(item.feature, item.index);
    });
    var unmatchedCount = targetFeatures.length - affectedEntities.length;
    var affectedSentence = affectedEntities.length
      ? (affectedEntities.length === 1 ? 'Se identificó 1 entidad' : 'Se identificaron ' + affectedEntities.length + ' entidades') +
        ' de «' + targetName + '» que ' + (affectedEntities.length === 1 ? 'intersecta' : 'intersectan') + ' el área'
      : 'No se identificaron entidades de «' + targetName + '» que intersecten el área';
    var unmatchedSentence = targetFeatures.length === 0
      ? 'la capa no contiene entidades para comparar'
      : unmatchedCount === 0
        ? 'todas las entidades evaluadas presentaron coincidencia'
      : unmatchedCount === 1
        ? '1 entidad no presentó coincidencia'
        : unmatchedCount + ' entidades no presentaron coincidencia';
    registrarOperacion({
      tool: 'Área de influencia (buffer)',
      inputs: bufferInputs,
      outputName: resultName,
      outputSummary: bufferSummary,
      procedure: 'Se generó un polígono de influencia alrededor de cada geometría válida de la capa de entrada' +
        (dissolveMode === 'dissolve' ? ' y se disolvieron las zonas resultantes.' : '.'),
      processedCount: input.length,
      parameters: { distancia: distance, unidad: etiquetaUnidadDistancia(unit), disolución: dissolveMode === 'dissolve' ? 'Disolver todos' : 'Mantener separados', segmentosPorBuffer: 8 },
      result: {
        metrics: {
          zonasGeneradas: buffered.length,
          superficieCalculada: bufferSummary.polygonAreaM2 === null
            ? 'No disponible'
            : reportNumberFormat.format(bufferSummary.polygonAreaM2 / 10000) + ' ha' +
              (dissolveMode === 'dissolve' ? ' (área disuelta)' : ' (suma por zona; puede incluir solapamientos)'),
          capaObjetivo: targetName || 'No seleccionada',
          entidadesObjetivoEvaluadas: targetName && !comparisonWarnings.length ? targetFeatures.length : 'No calculado',
          entidadesObjetivoIntersectadas: targetName && !comparisonWarnings.length ? affectedEntities.length : 'No calculado',
          entidadesObjetivoSinIntersección: targetName && !comparisonWarnings.length ? targetFeatures.length - affectedEntities.length : 'No calculado'
        },
        entities: affectedNames,
        rows: affectedEntities.slice(0, 100).map(function (item) {
          return [nombreCampoIdentificador(item.feature, item.index)];
        }),
        rowHeadings: ['Entidad de la capa objetivo que intersecta el área']
      },
      warnings: (erroresGeometria ? [erroresGeometria + ' geometrías no válidas de la capa de entrada fueron omitidas.'] : []).concat(comparisonWarnings),
      interpretation: 'El procedimiento delimitó un área de influencia de ' + distance + ' ' + etiquetaUnidadDistancia(unit) +
        ' alrededor de ' + (input.length - erroresGeometria) + ' geometrías válidas de «' + name +
        '».' + (targetName && !comparisonWarnings.length
          ? ' ' + affectedSentence + '; ' + unmatchedSentence + ' en este cruce.'
          : targetName
            ? ' No fue posible completar el cruce con la capa objetivo, por lo que su conteo no se informa.'
            : ' No se seleccionó una capa objetivo para identificar entidades coincidentes.') +
        ' La relación espacial es preliminar y no determina por sí sola una afectación legal, ambiental o predial.'
    });
    var cantidadAreas = buffered.length === 1 ? '1 área de influencia' : buffered.length + ' áreas de influencia';
    avisarAnalisis((buffered.length === 1 ? 'Se creó ' : 'Se crearon ') + cantidadAreas + ' en «' + resultName + '». Área total: ' + (buffered.reduce(function (sum, f) { return sum + (f.properties.area_m2 || 0); }, 0) / 10000).toFixed(2) + ' ha.' +
      (targetName && !comparisonWarnings.length ? ' Entidades coincidentes en «' + targetName + '»: ' + affectedEntities.length + '.' : '') +
      (erroresGeometria ? ' Se omitieron ' + erroresGeometria + ' geometrías inválidas.' : '') +
      (comparisonWarnings.length ? ' Advertencia: ' + comparisonWarnings[0] : ''));
  } catch (error) {
    console.error(error);
    registrarErrorAnalisis('Área de influencia (buffer)', error.message, [name], {
      distancia: distance,
      unidad: unit,
      disolución: document.getElementById('bufferDissolve').value
    });
    avisarAnalisis(error.message || 'No se pudo crear el área de influencia.', true);
  }
  finally { runButton.disabled = false; }
});

function actualizarCamposClasificacion() {
  var layer = capas[document.getElementById('classLayer').value];
  var select = document.getElementById('classField'); if (!select) return;
  select.replaceChildren();
  var fields = [];
  (layer && layer._attributeFeatures || []).forEach(function (feature) { Object.keys(feature.properties || {}).forEach(function (key) { if (key.charAt(0) !== '_' && fields.indexOf(key) === -1) fields.push(key); }); });
  fields.forEach(function (field) { var option = document.createElement('option'); option.value = field; option.textContent = field; select.appendChild(option); });
}

function aplicarEstiloClasificacion(layer, field, groups, colors, method) {
  layer._styleFunction = function (feature) {
    var color = colorClasificacionParaEntidad(feature, field, groups, colors, method);
    if (!color) return { color: '#75869a', weight: 1, fillColor: '#cbd5df', fillOpacity: .3, opacity: .8 };
    return { color: color, weight: 1.4, fillColor: color, fillOpacity: .55, opacity: .9 };
  };
  recorrerEntidadesEstilizables(layer, function (featureLayer) {
    var style = layer._styleFunction(featureLayer.feature);
    if (style) featureLayer.setStyle(ajustarEstiloOpacidad(layer, style));
  });
}

function ajustarEstiloOpacidad(layer, style) {
  var opacity = Number.isFinite(layer._opacity) ? layer._opacity : 1;
  var adjusted = Object.assign({}, style);
  adjusted.opacity = (style.opacity === undefined ? 1 : style.opacity) * opacity;
  adjusted.fillOpacity = (style.fillOpacity === undefined ? 0.2 : style.fillOpacity) * opacity;
  return adjusted;
}

function aplicarOpacidadCapa(layer) {
  recorrerEntidadesEstilizables(layer, function (featureLayer) {
    var style = layer._styleFunction ? layer._styleFunction(featureLayer.feature) : null;
    if (style && typeof featureLayer.setStyle === 'function') featureLayer.setStyle(ajustarEstiloOpacidad(layer, style));
  });
}

function recorrerEntidadesEstilizables(layer, callback) {
  if (!layer) return;
  if (layer.feature && typeof layer.setStyle === 'function') callback(layer);
  if (typeof layer.eachLayer === 'function') layer.eachLayer(function (child) { recorrerEntidadesEstilizables(child, callback); });
}

document.getElementById('classLayer').addEventListener('change', async function () {
  var layer = capas[this.value];
  try {
    if (layer && !layer._attributesReady) avisarAnalisis('Cargando atributos de «' + this.value + '»…');
    if (layer) await asegurarCargaCapa(layer);
    actualizarCamposClasificacion();
    if (layer) avisarAnalisis('Capa lista. Elige el campo que quieres clasificar.');
  } catch (error) { avisarAnalisis(error.message || 'No se pudo cargar esa capa para clasificar.', true); }
});
['classField', 'classMethod', 'classPalette'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', function () {
    var layerName = document.getElementById('classLayer').value;
    var field = document.getElementById('classField').value;
    if (layerName && field) document.getElementById('applyClassification').click();
  });
});
document.getElementById('applyClassification').addEventListener('click', async function () {
  var button = this;
  button.disabled = true;
  try {
    avisarAnalisis('Cargando datos y preparando la clasificación…');
    var name = document.getElementById('classLayer').value;
    var layer = capas[name];
    if (!layer) throw new Error('Selecciona una capa.');
    await asegurarCargaCapa(layer); actualizarCamposClasificacion();
    // La clasificación también debe mostrar la capa si solo se cargaron sus atributos desde el selector.
    if (layer._mapFeaturesReady) layer.addTo(map);
    else await prepararRenderizadoCapa(layer);
    var field = document.getElementById('classField').value;
    if (!field) throw new Error('Elige un campo que tenga atributos.');
    var requestedMethod = document.getElementById('classMethod').value;
    var features = layer._attributeFeatures || [];
    var rawValues = features.map(function (feature) { return feature.properties && feature.properties[field]; });
    var values = rawValues.filter(function (value) {
      return value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
    });
    if (!values.length) throw new Error('El campo seleccionado no tiene valores para clasificar.');
    var method = requestedMethod;
    if (requestedMethod === 'auto') {
      var isNumericField = values.every(function (value) {
        return typeof value !== 'boolean' &&
          (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') &&
          Number.isFinite(Number(value));
      });
      method = isNumericField ? 'quantile' : 'unique';
    }
    var groups = [];
    var classifiableCount = 0;
    if (method === 'unique') {
      var unique = Array.from(new Set(values.map(String)));
      if (unique.length > 50) throw new Error('Este campo tiene más de 50 valores únicos; elige un campo más acotado.');
      groups = unique.map(function (value) { return { value: value, label: value }; });
      classifiableCount = values.length;
    } else {
      var numbers = values.map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; });
      if (!numbers.length) throw new Error('El campo seleccionado no contiene valores numéricos.');
      classifiableCount = numbers.length;
      var min = numbers[0];
      var max = numbers[numbers.length - 1];
      var distinctValueCount = new Set(numbers).size;
      var requestedCount = calcularCantidadClasesAutomatica(numbers.length, distinctValueCount);
      if (min === max) {
        groups = [{ min: min, max: max, label: min.toLocaleString('es-CO') }];
      } else if (method === 'quantile') {
        groups = crearGruposCuantiles(numbers, requestedCount);
      } else {
        for (var i = 0; i < requestedCount; i += 1) {
          var lower = min + (max - min) * i / requestedCount;
          var upper = i === requestedCount - 1 ? max : min + (max - min) * (i + 1) / requestedCount;
          groups.push({
            min: lower,
            max: upper,
            upperExclusive: i < requestedCount - 1,
            label: lower.toLocaleString('es-CO', { maximumFractionDigits: 2 }) + ' – ' +
              upper.toLocaleString('es-CO', { maximumFractionDigits: 2 })
          });
        }
      }
    }
    if (!groups.length) throw new Error('No hay valores para clasificar.');
    groups.forEach(function (group) { group.count = 0; });
    features.forEach(function (feature) {
      var index = indiceGrupoClasificacion(feature.properties && feature.properties[field], groups, method);
      if (index >= 0) groups[index].count += 1;
    });
    var missingCount = features.length - classifiableCount;
    var paletteName = document.getElementById('classPalette').value;
    var colors = coloresClasificacion(groups.length, method, field, paletteName);
    aplicarEstiloClasificacion(layer, field, groups, colors, method);
    var bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.12), { maxZoom: 16 });
    var legend = document.getElementById('classificationLegend'); legend.replaceChildren();
    layer._classification = {
      field: field, groups: groups, colors: colors, method: method,
      palette: method === 'unique' ? 'categorical' : paletteName,
      requestedMethod: requestedMethod, missingCount: missingCount, totalCount: features.length
    };
    groups.forEach(function (group, i) {
      var row = document.createElement('div'); row.className = 'legend-row';
      var picker = document.createElement('input'); picker.type = 'color'; picker.className = 'legend-color-picker'; picker.value = colors[i]; picker.setAttribute('aria-label', 'Color para ' + group.label);
      picker.addEventListener('input', function () {
        colors[i] = picker.value;
        aplicarEstiloClasificacion(layer, field, groups, colors, method);
        actualizarLeyendaMapa();
      });
      var label = document.createElement('span');
      label.className = 'classification-label';
      label.textContent = group.label;
      var count = document.createElement('strong');
      count.className = 'classification-count';
      count.textContent = group.count.toLocaleString('es-CO');
      count.title = group.count.toLocaleString('es-CO') + ' entidades';
      row.append(picker, label, count);
      legend.appendChild(row);
    });
    if (missingCount > 0) {
      var missingRow = document.createElement('div');
      missingRow.className = 'legend-row classification-missing';
      var missingSwatch = document.createElement('span');
      missingSwatch.className = 'legend-swatch';
      missingSwatch.style.backgroundColor = '#cbd5df';
      var missingLabel = document.createElement('span');
      missingLabel.textContent = 'Sin dato';
      var missingValue = document.createElement('strong');
      missingValue.className = 'classification-count';
      missingValue.textContent = missingCount.toLocaleString('es-CO');
      missingRow.append(missingSwatch, missingLabel, missingValue);
      legend.appendChild(missingRow);
    }
    var legendSummary = document.createElement('p');
    legendSummary.className = 'classification-summary';
    legendSummary.textContent = groups.length.toLocaleString('es-CO') + ' clases · ' +
      classifiableCount.toLocaleString('es-CO') + ' entidades clasificadas' +
      (missingCount ? ' · ' + missingCount.toLocaleString('es-CO') + ' sin dato' : '');
    legend.appendChild(legendSummary);
    actualizarLeyendaMapa();
    actualizarListaCapas();
    var nombreCampoNormalizado = String(field).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var tipoSimbologia = method === 'unique' ? 'colores categóricos' : /cambio|variaci|diferencia|balance|anomal/.test(nombreCampoNormalizado) ? 'escala divergente' : 'escala gradual de menor a mayor';
    var methodDescription = requestedMethod === 'auto'
      ? ' (método automático: ' + (method === 'unique' ? 'valores únicos' : 'cuantiles') + ')'
      : '';
    registrarOperacion({
      tool: 'Clasificación temática de atributos',
      inputs: [referenciaCapa(name, features)],
      procedure: 'Se clasificaron los valores del atributo «' + field + '» para simbolizar espacialmente la capa.',
      processedCount: features.length,
      parameters: { campo: field, métodoSolicitado: requestedMethod, métodoAplicado: method, paleta: layer._classification.palette },
      result: {
        metrics: {
          clasesGeneradas: groups.length,
          entidadesClasificadas: classifiableCount,
          entidadesSinDato: missingCount
        },
        rows: groups.map(function (group) {
          return [group.label, group.count.toLocaleString('es-CO')];
        }),
        rowHeadings: ['Clase', 'Entidades']
      },
      interpretation: 'La simbología organiza las entidades según los valores disponibles en «' + field +
        '»; las clases facilitan la comparación visual y no alteran la geometría ni los atributos originales.'
    });
    avisarAnalisis('Clasificación aplicada a «' + name + '» usando ' + field + methodDescription + ' con ' + tipoSimbologia +
      ': ' + groups.length + (groups.length === 1 ? ' clase' : ' clases') + ' calculadas automáticamente, ' +
      classifiableCount.toLocaleString('es-CO') + ' entidades.' +
      (missingCount ? ' ' + missingCount.toLocaleString('es-CO') + ' sin dato.' : ''));
  } catch (error) {
    console.error('No se pudo clasificar la capa:', error);
    registrarErrorAnalisis('Clasificación temática de atributos', error.message, [name], {
      campo: field,
      método: document.getElementById('classMethod').value
    });
    avisarAnalisis(error.message || 'No se pudo clasificar la capa.', true);
  } finally { button.disabled = false; }
});
llenarSelectoresAnalisis();

var resetViewBtn = document.getElementById('resetViewBtn');
if (resetViewBtn) {
  resetViewBtn.addEventListener('click', function () {
    if (limitesRasters.isValid()) {
      map.fitBounds(limitesRasters.pad(0.2));
    } else {
      map.setView([6.337, -75.558], 13);
    }
  });
}

map.whenReady(function () {
  if (limitesRasters.isValid()) {
    map.fitBounds(limitesRasters.pad(0.2));
  }
});

    
