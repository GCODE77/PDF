param([int]$Port = 8772)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{'.html'='text/html; charset=utf-8';'.js'='text/javascript';'.mjs'='text/javascript';'.css'='text/css';'.json'='application/json';'.webmanifest'='application/manifest+json';'.wasm'='application/wasm';'.png'='image/png';'.svg'='image/svg+xml';'.ttf'='font/ttf';'.gz'='application/gzip';'.map'='application/json'}
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "PDF Gongjakso running at http://localhost:$Port/  (close this window to stop)"
Start-Process "http://localhost:$Port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
    if ($p -eq '') { $p = 'index.html' }
    $f = [IO.Path]::GetFullPath((Join-Path $root $p))
    if ($f.StartsWith($root) -and (Test-Path $f -PathType Leaf)) {
      $b = [IO.File]::ReadAllBytes($f)
      $e = [IO.Path]::GetExtension($f).ToLower()
      $c.Response.ContentType = $(if ($mime.ContainsKey($e)) { $mime[$e] } else { 'application/octet-stream' })
      $c.Response.ContentLength64 = $b.Length
      $c.Response.OutputStream.Write($b, 0, $b.Length)
    } else { $c.Response.StatusCode = 404 }
  } catch { $c.Response.StatusCode = 500 }
  $c.Response.Close()
}
