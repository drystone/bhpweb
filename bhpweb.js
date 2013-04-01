var http = require('http');
var fs = require('fs');

function respond(req, res) {
  if (req.url === "/") {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<!doctype html>\n'
       + '<html doctype="html">\n'
       + '	<head>\n'
       + '		<link rel="stylesheet" href="bhpweb.css">\n'
	   + '		<script language="text/javascript" src="bhpweb-client.js"></script>\n'
       + '		<title>bhpweburnator 3000</title>\n'
       + '	</head>\n'
       + '	<body>\n'
	   + '	  <div id="bhpweb">\n'
	   + '    </div>\n'
       + '  </body>\n'
       + '</html>\n');
  } else if (req.url === "/bhpweb.css") {
    res.writeHead(200, {'Content-Type': 'text/css'});
	res.end(fs.readFileSync("bhpweb.css"));
  } else if (req.url === "/bhpweb-client.js") {
    res.writeHead(200, {'Content-Type': 'text/javascript'});
	res.end(fs.readFileSync("bhpweb-client.js"));
  } else {
    res.writeHead(404, {'Content-Type': 'text/html'});
    res.write("<h1>404 Not Found</h1>");
    res.end("The page you were looking for: " + req.url + " can not be found");
  }
}

server = http.createServer(respond);

server.listen(1337, '');

console.log('Server running at http://127.0.0.1:1337/');