const net = require('net');
const WebSocket = require('ws');
const connect = require('connect');
const serveStatic = require('serve-static');

// ----- Static web-server ---------------------------------------------------

connect().use(serveStatic('static')).listen(5400, function(){});

// ----- Rotator model -------------------------------------------------------

const azSpeed = 2.1; // degrees per second
const elSpeed = 1.7;

var status = {
 az: Math.random() * 360.0,
 el: Math.random() * 90.0,
 rx: 435 + Math.random() * 3.0,
 tx: 144 + Math.random() * 2.0,
 stop: Math.random() > 0.5 ? 'north' : 'south',
 active: true,
 demonstrationMode: true
};
var target = {};

function set_pos(az, el) {
 target = {
  'az': az,
  'el': el,
  'anticlockwise': (azDelta(az) < 0)
 };
 status.active = true;
 console.log('set_pos(' + az + ', ' + el + '): target == ' + JSON.stringify(target));
}

function setRandomPos() {
 set_pos(Math.random() * 360.0, Math.random() * 90.0);
}

function deltaAtSpeed(s, t, speed) {
 var delta = t - s;
 result = Math.abs(delta) < speed ? delta : speed * (delta < 0.0 ? -1.0 : 1.0);
 return result;
}

function azDelta(targetAz) { // N.B. must be passed targetAz to allow setting anticlockwise before replacing target
 var result = 
  (status.stop == 'north')
  ? deltaAtSpeed(status.az, targetAz, azSpeed)
  : deltaAtSpeed((status.az + 180.0) % 360.0, (targetAz + 180.0) % 360.0, azSpeed) // swap semi-circles for stop == south
 return result;
}

function updateAz() {
 status.az = (status.az + azDelta(target.az) + 360.0) % 360.0; // correct for negative result
}

function updateEl() {
 status.el += deltaAtSpeed(status.el, target.el, elSpeed);
}

function needToMove(a, b) {
 return Math.abs(a - b) > 1.0;
}

// ----- Simulator backend ---------------------------------------------------

var wss = new WebSocket.Server({ port: 5401 });
wss.on('connection', function connection(ws) {
 console.log('simulator connected');

 function statusUpdate() {
  if (status.active) {
   if (needToMove(status.az, target.az))
    updateAz();
   else if (needToMove(status.el, target.el))
    updateEl();
   else if (status.demonstrationMode)
    setRandomPos();
   else
    status.active = false;
  }

  console.log(JSON.stringify({ 'status': status, 'target': target }));
  ws.send(JSON.stringify({ 'status': status, 'target': target }));
 }
 var interval = setInterval(statusUpdate, 1000);

 ws.onclose = function(event) {
  console.log('simulator connection closed');
  clearInterval(interval);
 }
});
console.log('WS 4501 SS Running');

// ----- rotctl net protocol -------------------------------------------------

const RIG_OK = 0,        /*!< No error, operation completed successfully */
      RIG_EINVAL = 1,    /*!< invalid parameter */
      RIG_ECONF = 2,     /*!< invalid configuration (serial,..) */
      RIG_ENOMEM = 3,    /*!< memory shortage */
      RIG_ENIMPL = 4,    /*!< function not implemented, but will be */
      RIG_ETIMEOUT = 5,  /*!< communication timed out */
      RIG_EIO = 6,       /*!< IO error, including open failed */
      RIG_EINTERNAL = 7, /*!< Internal Hamlib error, huh! */
      RIG_EPROTO = 8,    /*!< Protocol error */
      RIG_ERJCTED = 9,   /*!< Command rejected by the rig */
      RIG_ETRUNC = 10,   /*!< Command performed, but arg truncated */
      RIG_ENAVAIL = 11,  /*!< function not available */
      RIG_ENTARGET = 12, /*!< VFO not targetable */
      RIG_BUSERROR = 13, /*!< Error talking on the bus */
      RIG_BUSBUSY = 14,  /*!< Collision on the bus */
      RIG_EARG = 15,     /*!< NULL RIG handle or any invalid pointer parameter in get arg */
      RIG_EVFO = 16,     /*!< Invalid VFO */
      RIG_EDOM = 17;     /*!< Argument out of domain of func */

function report(socket, code) {
 console.log('report(' + code + ')');
 socket.write('RPRT ' + code + '\n');
}

net.createServer(function(socket) {
 socket.on('data', function(data) {
  status.demonstrationMode = false;
  var dataString = data.toString();
console.log('rotctld received [' + dataString + ']');
  if (dataString.localeCompare('p\n') == 0) {
   socket.write('0.000000\n'); // fake az
   socket.write('0.000000\n'); // fake el
  } else if (dataString.startsWith('P ')) {
   if (!status.active) {
    var args = dataString.split(' ');
    newAz = parseFloat(args[1]);
    newEl = parseFloat(args[2]);
console.log('newAz == ' + newAz + ', newEl == ' + newEl);
    if (isNaN(newAz) || isNaN(newEl)) {
     status.active = false;
     report(socket, RIG_EINVAL);
    } else {
     set_pos(newAz, newEl);
     report(socket, RIG_OK);
    }
   } else { // report OK but take no action if already busy
    report(socket, RIG_OK);
   }
  } else if (dataString.localeCompare('S\n') == 0) {
   status.active = false;
   report(socket, RIG_OK);
  } else if (dataString.localeCompare('q\n') == 0) {
   status.active = false;
   socket.end();
  } else {
   status.active = false;
   report(socket, RIG_ENIMPL);
  }
 });
 socket.on('close', function(data) {
  console.log('rotctld connection closed');
  status.active = false;
 });
}).listen(4533, '127.0.0.1');
console.log('tcp://4533 Device Simulator Running');
