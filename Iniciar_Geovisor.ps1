param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8080)

try {
    $listener.Start()
} catch {
    Write-Host 'No se pudo iniciar el servidor en http://localhost:8080/.' -ForegroundColor Red
    Write-Host 'Cierra otra instancia del geovisor e inténtalo de nuevo.'
    exit 1
}

Write-Host 'Geovisor disponible en http://localhost:8080/' -ForegroundColor Green
Write-Host 'Deja esta ventana abierta mientras lo usas. Presiona Ctrl+C para cerrar.'
if (-not $NoBrowser) { Start-Process 'http://localhost:8080/' }

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.zip'  = 'application/zip'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while ($null -ne ($headerLine = $reader.ReadLine()) -and $headerLine -ne '') { }

            $statusCode = 200
            $statusText = 'OK'
            $body = [byte[]]@()
            $contentType = 'text/plain; charset=utf-8'
            $method = ''

            if ($requestLine) {
                $requestParts = $requestLine.Split(' ')
                if ($requestParts.Length -ge 2) {
                    $method = $requestParts[0]
                    if ($method -ne 'GET' -and $method -ne 'HEAD') {
                        $statusCode = 405
                        $statusText = 'Method Not Allowed'
                    } else {
                        $requestPath = ($requestParts[1] -split '\?', 2)[0]
                        $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart('/')).Replace('/', [IO.Path]::DirectorySeparatorChar)
                        if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
                        $filePath = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relativePath))
                        $rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

                        if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($filePath)) {
                            $statusCode = 404
                            $statusText = 'Not Found'
                        } else {
                            $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
                            if ($mimeTypes.ContainsKey($extension)) { $contentType = $mimeTypes[$extension] }
                            $body = [IO.File]::ReadAllBytes($filePath)
                        }
                    }
                } else {
                    $statusCode = 400
                    $statusText = 'Bad Request'
                }
            }

            $responseHeaders = "HTTP/1.1 $statusCode $statusText`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($responseHeaders)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -eq 'GET' -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch {
            Write-Host ('Error al servir una solicitud: ' + $_.Exception.Message) -ForegroundColor Red
        } finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Dispose()
            $reader = $null
            $stream = $null
        }
    }
} finally {
    $listener.Stop()
}
