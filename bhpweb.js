var async = require('async');
var http = require('http');
var fs = require('fs');
var events = require('events');
var xml2js = require('xml2js');
var argv = require('optimist').argv;
var port = argv.p ? argv.p : 1337;
var host = "n" in argv ? argv.n : 'localhost'; // '' or 0.0.0.0 for all
if (host === '') host = '0.0.0.0';

var bhpConfigDir = argv.c ? argv.c : '.';
var bhpDataDir = argv.d ? argv.d : '.';
var routinesFile = bhpConfigDir + '/routines.xml';
var temperaturesFile = bhpDataDir + '/temperatures.xml';

var eventEmitter = new events.EventEmitter();
eventEmitter.setMaxListeners(0); // diables 'too may listeners' warning
var timers = [], weeklies = [], specials = [];
var temperaturesSSE;
var zonesSSE;
var zones = [];
var zoneStates = {};

Date.prototype.getTimeS = function() { return Math.floor(this.getTime()/1000) }

function duration(xsduration) {
    // convert xs:duration to ms
    // only does DHMS, +ve without ms
    var cur = 0;
    var seconds = 0;

    for (var i = 0; i < xsduration.length; i++) {
        switch (xsduration[i]) {
        case 'P':
        case 'T':
            break;
        case 'D':
            cur *= 24;
        case 'H':
            cur *= 60;
        case 'M':
            cur *= 60;
        case 'S':
            seconds += cur;
            cur = 0;
            break;
        default:
            cur = cur * 10 + xsduration.charCodeAt(i) - '0'.charCodeAt(0);
            break;
        }
    }
    return seconds;
}

function loadXml(file, onLoaded) {
    var parser = new xml2js.Parser();
    fs.readFile(file, function(err, data) {
        parser.parseString(data, function (err, result) {
            onLoaded(result);
        });
    });
}

function mkRoutinesSSE() {

    function mkr(rid, s, e) {
        return {
            'rid'     : rid,
            'start'   : Math.max(s, start),
            'end'     : Math.min(e, end)
        };
    }

    var routines = [];
    var start = new Date().getTimeS() - 24 * 60 * 60;
    var end = start + 48 * 60 * 60;
    var dayStart = new Date(start * 1000);
    dayStart.setSeconds(0);
    dayStart.setMinutes(0);
    dayStart.setHours(0);
    var weekStart = dayStart.getTimeS() - dayStart.getDay() * 24 * 60 * 60;
    dayStart = dayStart.getTimeS();

    var normalisedTimers = [];
    for (var o = dayStart; o < end; o += 24 * 60 * 60) {
        normalisedTimers = normalisedTimers.concat(timers.map(function(t) { return {
            'rid'   : t.rid
          , 'zid'   : t.zid
          , 'start' : o + t.start
          , 'end'   : o + t.end
          , 'temp'  : t.temp
        };}));
    }

    var spans = [];
    weeklies.forEach(function(w) {
        for (var o = weekStart; o < end; o += 7 * 24 * 60 * 60) {
            var s = o + w.start;
            var e = o + w.end;
            if (e > start && s < end)
                spans.push(mkr(w.rid, s, e));
        }
    });

    specials.forEach(function(s) {
        if (s.end > start && s.start < end)
            spans.push(mkr(s.rid, s.start, s.end));
    });

    zones.forEach(function(z) {
        function overlay(switches, start, end, temp) {
            return switches.filter(function(s) { return s.time < start; })
            .concat([{ 
                'time' : start
              , 'temp' : temp
            }, { 
                'time' : end
              , 'temp' : switches.filter(function(s) { return s.time <= end }).pop().temp
            }])
            .concat(switches.filter(function(s) { return s.time > end; }));
        }

        var switches = [{
            'time' : start
          , 'temp' : zoneStates[z.id].off
        }, {
            'time' : end
          , 'temp' : zoneStates[z.id].off
        }];

        spans.forEach(function(r) {
            normalisedTimers.filter(function(t) {
                return t.rid == r.rid && t.zid == z.id && t.end > start && t.start < end;
            }).forEach(function(t) {
                switches = overlay(switches, Math.max(start, t.start), Math.min(end, t.end), t.temp);
            });
        });
        routines.push({'zone' : z.id, 'switches' : switches});
    });
    return 'event: routines\ndata: ' + JSON.stringify(routines) + '\n\n';
}

function loadRoutines(callback) {
    loadXml(routinesFile, function(xml) {
        timers = [];
        xml.routines['daily-routine'].forEach(function(n) {
            if ('timer' in n) {
                n.timer.forEach(function(nn) {
                    timers.push({
                        'rid'   : n.$.id
                      , 'zid'   : nn.$['zone-id']
                      , 'start' : duration(nn.$.start)
                      , 'end'   : duration(nn.$.end)
                      , 'state' : nn.$.state
                      , 'temp'  : zoneStates[nn.$['zone-id']][nn.$.state]
                    });
                });
            }
        });
        weeklies = [];
        xml.routines['weekly-routines'][0]['weekly-routine'].forEach(function(n) {
            weeklies.push({
                'rid'   : n.$['routine-id'],
                'start' : duration(n.$.start),
                'end'   : duration(n.$.end)
            });
        });
        specials = [];
        xml.routines['special-routines'][0]['special-routine'].forEach(function(n) {
            specials.push({
                'rid'   : n.$['routine-id'],
                'start' : new Date(n.$.start).getTimeS(),
                'end'   : new Date(n.$.end).getTimeS()
            });
        });
        callback();
    });
}

function loadTemperatures(callback) {
    loadXml(temperaturesFile, function(xml) {
        var temperatures = {};
        xml.temperatures.temperature.forEach(function(n) {
            temperatures[n.$['thermometer-id']] = n._;
        });
        temperaturesSSE = 'event: temperatures\ndata: ' + JSON.stringify(temperatures) + '\n\n';
        callback();
    });
}

async.parallel([
    function(callback) {
        loadXml(bhpConfigDir + '/zones.xml', function(xml) {
            zones = [];
            zoneStates = {};
            xml.zones.zone.forEach(function(n) {
                zones.push({
                    'id'      : n.$.id
                  , 'name'    : n.$.name
                });
                zoneStates[n.$.id] = {
                    'off'     : n.$.off
                  , 'standby' : n.$.standby
                  , 'on'      : n.$.on
                };
            });
            zonesSSE = 'event: zones\ndata: ' + JSON.stringify(zones) + '\n\n';
            callback(null, null);
        });
    },
    function(callback) {
        loadRoutines(function() {
            callback(null, null);
        });
    },
    function(callback) {
        loadTemperatures(function() {
            callback(null, null);
        });
    }
]);

// wrap fs.watch to watch dir and detect inode changes for file
// fs.watch watches an inode and stops triggering when new file is renamed over watched file
function watch(file, callback) {
    var dir = file.substring(0, file.lastIndexOf('/'));
    var inode = fs.statSync(file).ino;
    fs.watch(dir, function(e, f) {
        var t = fs.statSync(file).ino;
        if (t != inode) {
            inode = t;
            callback();
        }
    });
}

watch(routinesFile, function() {
    loadRoutines(function() {
        eventEmitter.emit('routines');
    });
});

watch(temperaturesFile, function() {
    loadTemperatures(function() {
        eventEmitter.emit('temperatures');
    });
});

http.createServer(function respond(req, res) {

    if (req.url === "/") {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<!doctype html>\n'
            + '<html doctype="html">\n'
            + '  <head>\n'
            + '    <link rel="stylesheet" href="bhpweb.css">\n'
            + '    <script type="text/javascript" src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>\n'
            + '    <script type="text/javascript" src="bhpweb-client.js"></script>\n'
            + '    <title>bhpweburnator 3000</title>\n'
            + '  </head>\n'
            + '  <body>\n'
            + '    <ul id="bhpweb"/>\n'
            + '  </body>\n'
            + '</html>\n');
    } else if (req.url === "/bhpweb.css") {
        res.writeHead(200, {'Content-Type': 'text/css'});
        res.end(fs.readFileSync("bhpweb.css"));
    } else if (req.url === "/bhpweb-client.js") {
        res.writeHead(200, {'Content-Type': 'text/javascript'});
        res.end(fs.readFileSync("bhpweb-client.js"));
    } else if (req.url === "/bhpweb.events") {
        var closed = false;
        function routinesCallback() { if (!closed) res.write(mkRoutinesSSE()); }
        function temperaturesCallback() { if (!closed) res.write(temperaturesSSE); }
        function refreshRoutines(res) {
            if (!closed) { 
                res.write(mkRoutinesSSE());
                setTimeout(function() {
                    refreshRoutines(res);
                }, 300000);
            }
        }
        res.on('close', function() {
            res.end();
            closed = true;
            eventEmitter.removeListener('routines', routinesCallback);
            eventEmitter.removeListener('temperatures', temperaturesCallback);
        });
        res.writeHead(200, {  'Content-Type' : 'text/event-stream'
                            , 'Cache-Control': 'no-cache'});
        res.write('retry: 10000\n');
        res.write(zonesSSE);
        refreshRoutines(res);
        res.write(temperaturesSSE);
        eventEmitter.on('routines', routinesCallback);
        eventEmitter.on('temperatures', temperaturesCallback);
    } else {
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.write("<h1>404 Not Found</h1>");
        res.end("The page you were looking for [" + req.url + "] cannot be found.");
    }
}).listen(port, host);

console.log('Server running at http://' + host + ':' + port);

