var async = require('async');
var http = require('http');
var qs = require('querystring');
var fs = require('fs');
var events = require('events');
var xml2js = require('xml2js');
var argv = require('optimist').argv;
var port = argv.p ? argv.p : 1337;
var host = "n" in argv ? argv.n : 'localhost'; // '' or 0.0.0.0 for all
if (host === '') host = '0.0.0.0';

var bhpConfigDir = argv.c ? argv.c : '.';
var bhpRunDir = argv.r ? argv.r : '.';
var bhpDataDir = argv.d ? argv.d : '.';
var temperaturesFile = bhpRunDir + '/temperatures.xml';
var overridesFile = bhpDataDir + '/overrides.xml';

var eventEmitter = new events.EventEmitter();
eventEmitter.setMaxListeners(0); // disables 'too may listeners' warning
var timers = [], weeklies = [], specials = [];
var temperaturesSSE;
var zonesSSE;
var zones = [];
var overrides = [];

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
            rid   : rid,
            start : Math.max(s, start),
            end   : Math.min(e, end)
        };
    }

    var routines = [];
    var now = new Date().getTimeS();
    var start = now - 24 * 60 * 60;
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
            rid   : t.rid
          , zid   : t.zid
          , start : o + t.start
          , end   : o + t.end
          , state : t.state
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
        function overlay(switches, start, end, state) {
            return switches.filter(function(s) { return s.time < start; })
            .concat([{ 
                time  : start
              , state : state
            }, { 
                time  : end
              , state : switches.filter(function(s) { return s.time <= end }).pop().state
            }])
            .concat(switches.filter(function(s) { return s.time > end; }));
        }

        function findOverride(type) {
            var o = overrides.filter(function(o) {
                return o.zid == z.id && o.type == type && now >= o.start && now < o.end;
            }).pop();
            return o ? {
                start : o.start
              , end   : o.end
              , state : o.state
            } : null;
        }

        var routine = {
            zone     : z.id
          , switches : [{
                time  : start
              , state : 'off'
            }, {
                time  : end
              , state : 'off'
            }]
        };

        spans.forEach(function(r) {
            normalisedTimers.filter(function(t) {
                return t.rid == r.rid && t.zid == z.id && t.end > start && t.start < end;
            }).forEach(function(t) {
                routine.switches = overlay(routine.switches, Math.max(start, t.start), Math.min(end, t.end), t.state);
            });
        });

        var b = findOverride('boost');
        if (b)
            routine.boost = b;

        var a = findOverride('advance');
        if (a)
            routine.advance = a;

        routines.push(routine);
    });
    return 'event: routines\ndata: ' + JSON.stringify(routines) + '\n\n';
}

function loadRoutines(callback) {
    loadXml(bhpConfigDir + '/routines.xml', function(xml) {
        timers = [];
        xml.routines['daily-routine'].forEach(function(n) {
            if ('timer' in n) {
                n.timer.forEach(function(nn) {
                    timers.push({
                        rid   : n.$['id']
                      , zid   : nn.$['zone-id']
                      , start : duration(nn.$['start'])
                      , end   : duration(nn.$['end'])
                      , state : nn.$['state']
                    });
                });
            }
        });
        weeklies = [];
        xml.routines['weekly-routines'][0]['weekly-routine'].forEach(function(n) {
            weeklies.push({
                rid   : n.$['routine-id'],
                start : duration(n.$['start']),
                end   : duration(n.$['end'])
            });
        });
        specials = [];
        xml.routines['special-routines'][0]['special-routine'].forEach(function(n) {
            specials.push({
                rid   : n.$['routine-id'],
                start : new Date(n.$['start']).getTimeS(),
                end   : new Date(n.$['end']).getTimeS()
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

function loadOverrides(callback) {
    loadXml(overridesFile, function(xml) {
        overrides = [];
        if ('override' in xml.overrides) {
            xml.overrides.override.forEach(function(n) {
                overrides.push({
                    zid   : n.$['zone-id']
                  , type  : n.$['type']
                  , start : new Date(n.$['start']).getTimeS()
                  , end   : new Date(n.$['end']).getTimeS()
                  , state : n.$['state']
                });
            });
        }
        callback(null, null);
    });
}

async.parallel([
    function(callback) {
        loadXml(bhpConfigDir + '/zones.xml', function(xml) {
            zones = [];
            xml.zones.zone.forEach(function(n) {
                zones.push({
                    id      : n.$['id']
                  , name    : n.$['name']
                  , off     : n.$['off']
                  , standby : n.$['standby']
                  , on      : n.$['on']
                });
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
    },
    function(callback) {
        loadOverrides(function() {
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

watch(overridesFile, function() {
    loadOverrides(function() {
        eventEmitter.emit('routines');
    });
});

watch(temperaturesFile, function() {
    loadTemperatures(function() {
        eventEmitter.emit('temperatures');
    });
});

http.createServer(function respond(req, res) {

    if (req.url == "/") {
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
    } else if (req.url == "/bhpweb.css") {
        res.writeHead(200, {'Content-Type': 'text/css'});
        res.end(fs.readFileSync("bhpweb.css"));
    } else if (req.url == "/bhpweb-client.js") {
        res.writeHead(200, {'Content-Type': 'text/javascript'});
        res.end(fs.readFileSync("bhpweb-client.js"));
    } else if (req.url == "/override") {
        if (req.method == 'POST') {
            var data = '';
            req.on('data', function(d) {
                data += d;
            });
            req.on('end', function() {
                var args = qs.parse(data);
                var zid = args.zid;
                var type = args.type;
                var duration = parseInt(args.duration);
                if (duration > 0 && duration <= 6 * 60 * 60 
                && (type == 'boost' || type == 'advance')
                && zones.some(function(z) { return z.id == zid; })) {
                    loadXml(overridesFile, function(xml) {
                        function mko(t, z, s, e) {
                            return '  <override type="' + t + '" zone-id="' + z + '" start="' + s + '" end="' + e + '"/>\n';
                        }
                        var tmpFile = bhpDataDir + '/' + Math.random();
                        var overrides = '<?xml version="1.0"?>\n<overrides>\n'
                        + ('override' in xml.overrides ? xml.overrides.override.map(function(o) {
                            return mko(o.$['type'], o.$['zone-id'], o.$['start'], o.$['end']);
                        }).join('') : '')
                        + mko(type, zid, new Date().toISOString(), new Date(new Date().getTime() + duration*1000).toISOString())
                        + '</overrides>\n';
                        fs.writeFile(tmpFile, overrides, function() {
                            fs.rename(tmpFile, overridesFile, function() {});
                        });
                    });
                }
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end();
            });
        } else {
            res.writeHead(405, {'Allow' : 'POST', 'Content-Type': 'text/plain'});
            res.end('405 - Method not allowed');
        }
    } else if (req.url == "/bhpweb.events") {
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
    console.log(zonesSSE);
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

