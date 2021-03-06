// TODO: implements the server for reciving RPC requests from clients
//   and register/unregister requests from services
var net = require('net'),
    Stub = require('../interface/stub'),
    ProtoBuf = require('protobufjs'),
    Cache = require('utils').Cache(),
    builder = ProtoBuf.loadProtoFile(__dirname + '/packet.proto'),
    Packet = builder.build('WebDE').Packet.PacketModel;

function PeerEnd() {
  this._port = 56765;
  // this._END = '0x1f17';
  this._token = 0;
  this._callStack = [];
  this._notifyCB = [];
  this._svrObj = new Cache(20); // svrName -> proxy obj
  this._svrList = []; // svrName -> module path
  this._connList = new Cache(20, {
    init: function(key, list) {
      list[key].timer = setTimeout(function() {
        try {
          list[key].val.release();
          list[key] = null;
          delete list[key];
          console.log('Connection to', key, 'has been closed');
        } catch(e) {
          console.log(e);
        }
      }, 120000);
    },
    update: function(key, list) {
      clearTimeout(list[key].timer);
      list[key].timer = setTimeout(function() {
        try {
          list[key].val.release();
          list[key] = null;
          delete list[key];
          console.log('Connection to', key, 'has been closed');
        } catch(e) {
          console.log(e);
        }
      }, 120000);
    },
    repTarget: function(list) {
      // need do nothing
    }
  })

  this._init();
}

PeerEnd.prototype._init = function() {
  // start up a server
  var self = this,
      server = self._server = net.createServer(function(cliSock) {
        self._accept(cliSock);
      });
  server.listen(self._port, function() {
    console.log('This peer is listening on', server.address());
  });
  server.on('error', function(e) {
    // TODO: handle errors occured on server
  });
}

PeerEnd.prototype._destroy = function() {
  // TODO: close all connections and server
  this._server.close();
}

PeerEnd.prototype._accept = function(cliSock) {
  // TODO: varify this connection
  var self = this;
  // TODO: cache accepted connection
  // self._connList.set(cliSock.remoteAddress, cliSock);
  cliSock.on('data', function(data) {
    console.log(this.remoteAddress + ':' + this.remotePort + ' sends: ', data);
    // TODO: make sure this is a completed data packet
    var dataArr = self._getPackets(data);
    for(var i = 0; i < dataArr.length; ++i) {
      if(dataArr[i] != '')
        self._dispatcher(dataArr[i], this.remoteAddress);
    }
  }).on('error', function(err) {
    // TODO: handle errors
    console.log(err);
  }).on('end', function() {
    // TODO: handle client disconnect
  });
}

PeerEnd.prototype._getPackets = function(rawData) {
  // return rawData.toString().split(this._END);
  // TODO: get data content from packet
  var total = rawData.length,
      offset = 0,
      bufArr = [];
  while(offset < total) {
    var l = rawData.slice(offset, offset + 2).readUInt16BE(0),
        L = l + 2;
    // console.log('getPackets:', total, offset, l);
    bufArr.push(rawData.slice(offset + 2, offset + L));
    offset += L;
  }
  return bufArr;
}

PeerEnd.prototype._packet = function(content) {
  if(typeof content.args !== 'undefined') {
    // transform args to String
    content.args = JSON.stringify(content.args);
  }
  if(typeof content.ret !== 'undefined') {
    // transform ret to String
    content.ret = JSON.stringify(content.ret);
  }
  // console.log('packet:', content);
  // put content into a data packet
  // return (JSON.stringify(content) + this._END);
  var packet = new Packet(content),
      pBuf = packet.encode().toBuffer(),
      pHead = new Buffer(2);
  pHead.writeUInt16BE(pBuf.length, 0, 2);
  return Buffer.concat([pHead, pBuf]);
}

PeerEnd.prototype._unpack = function(packet) {
  // get content from data packet
  var content = Packet.decode(packet);
  // console.log('unpack:', content);
  if(typeof content.args !== 'undefined') {
    // transform args to Array
    content.args = JSON.parse(content.args);
  }
  if(typeof content.ret !== 'undefined') {
    // transform ret to Array
    content.ret = JSON.parse(content.ret)
  }
  // return JSON.parse(packet);
  return content;
}

PeerEnd.prototype._dispatcher = function(msg, srcAddr) {
  // handle msgs from clients
  try {
    console.log('dispatcher:', msg);
    var content = this._unpack(msg);
    content.srcAddr = srcAddr;
    switch(content.action) {
      // TODO: run these handlers concurrently
      case 0: // call
        content.srcAddr = srcAddr;
        this._callHandler(content);
        break;
      case 1: // return
        this._returnHandler(content);
        break;
      case 2: // notify
        this._notifyHandler(content);
        break;
      default:
        break;
    }
  } catch(e) {
    console.log('dispatcher:', e);
  }
}

PeerEnd.prototype._callHandler = function(content) {
  // find Service proxy object based on svr of content
  console.log('Call request is recived');
  var self = this,
      svrProxy;
  try {
    svrProxy = self._svrObj.get(content.svr);
  } catch(e) {
    try {
      // console.log(self._svrList, content.svr, self._svrList[content.svr]);
      console.log('path:', self._svrList[content.svr], typeof self._svrList[content.svr]);
      svrProxy = require(self._svrList[content.svr]).getProxy();
      self._svrObj.set(content.svr, svrProxy);
    } catch(e) {
      // service not found
      console.log('callhandler:', e);
      self.send(content.srcAddr, {
        action: 1,
        svr: content.svr,
        token: content.token,
        func: content.func,
        ret: ['Service not found']
      });
    }
  }
  // specify on/off call's callback
  if(content.func == 'on') {
    if(typeof self._notifyCB[content.srcAddr] === 'undefined')
      self._notifyCB[content.srcAddr] = {};
    if(typeof self._notifyCB[content.srcAddr][content.svr] !== 'undefined')
      return ;
    self._notifyCB[content.srcAddr][content.svr] = function() {
      self.send(content.srcAddr, {
        action: 2,
        svr: content.svr,
        func: content.func,
        args: [content.args[0]].concat(Array.prototype.slice.call(arguments, 0))
      });
    };
    content.args.push(self._notifyCB[content.srcAddr][content.svr]);
  } else if(content.func == 'off') {
    // TODO: maybe has a bug
    content.args.push(self._notifyCB[content.srcAddr][content.svr]);
    self._notifyCB[content.srcAddr][content.svr] = null;
    delete self._notifyCB[content.srcAddr][content.svr];
  } else {
    content.args.push(function(result) {
      // send result to client
      self.send(content.srcAddr, {
        action: 1,
        svr: content.svr,
        token: content.token,
        func: content.func,
        ret: [null, result]
      });
    });
  }
  svrProxy[content.func].apply(svrProxy, content.args);
}

PeerEnd.prototype._returnHandler = function(content) {
  // find cb from call stack based on token of content
  console.log('Call return is recived');
  if(typeof this._callStack[content.token] === 'undefined')
    return console.log('Callback not found');
  this._callStack[content.token].apply(this, content.ret);
  this._callStack[content.token] = null;
  delete this._callStack[content.token];
}

PeerEnd.prototype._notifyHandler = function(content) {
  // use stub to notify targets
  console.log('Notify is recived');
  stub.notify.apply(stub, content.args);
}

// TODO: maintain a connection for seconds, close idle connections
//  which have none communication with the peer out of time.
PeerEnd.prototype._getConnection = function(ip) {
  var client, self = this;
  try {
    client = self._connList.get(ip);
  } catch(e) {
    client = net.connect(self._port, ip, function() {
      // connected successfully
      self._connList.set(ip, client);
    });
    client.setKeepAlive(true);
    client.release = client.destroy;
    self._accept(client);
    /* client.on('data', function(data) { */
      // // TODO: handle data from server
    // }).on('error', function(err) {
      // // TODO: handle errors
      // console.log(err);
    // }).on('end', function() {
      // // TODO: disconnected from server
    /* }); */
  }
  return client;
}

PeerEnd.prototype._contentVarify = function(content) {
  if(typeof content !== 'object')
    return 'Invalid type of content, should be an object';
  if(content.action < 0 && content.action > 2)
    return 'Unknown action';
  return null;
}

// TODO: API for clients to send sth to peers
// content -> JSON object: {
//  action: {call(0)|return(1)|notify(2)} -> Number,
//  svr: {the name of service} -> String,
//  func: {the name of function to be called} -> String,
//  args: {args needed} -> Array
// }
// e.g. {
//  action: 0(or 1),
//  svr: 'service1'
//  func: 'fn1',
//  args: [arg1, arg2](or [ret])
// },
// {
//  action: 2,
//  args: [event, arg1, arg2]
// }
PeerEnd.prototype.send = function(dstAddr, content, callback) {
  console.log('Send has been called.');
  var cb = callback || function() {};
  var ret;
  if((ret = this._contentVarify(content)) != null) {
    return cb(ret);
  }
  if(content.action == 0) {
    // TODO: generate a token
    content.token = this._token++;
    this._callStack[content.token] = cb;
  } else if(content.action == 2 && dstAddr == 'local') {
    // intent to local processes
    this._notifyHandler(content);
    return cb(null, 0);
  }
  if(net.isIP(dstAddr) == 0)
    return cb('Invalid IP address');
  var conn = this._getConnection(dstAddr);
  conn.write(this._packet(content), function() {
    // TODO: do sth after sending packet
    // If this is a RPC msg, call this callback after reciving responses from remote
    if(content.action != 0 || content.func == 'on' || content.func == 'off') {
      // console.log(content.action, 'call return');
      cb(null, 0);
    }
  });
}

// API for clients to register services
PeerEnd.prototype.register = function(svcList, callback) {
  var cb = callback || function() {},
      ret = [];
  for(var key in svcList) {
    if(typeof this._svrList[key] !== 'undefined') {
      ret.push(key);
      continue;
    }
    // TODO: varify this svrAddr
    this._svrList[key] = svcList[key];
    console.log(key, 'registered OK!');
  }
  cb((ret.length > 0 ? ('Service ' + ret.join(',') + ' has been registered.') : null));
}

// API for clients to unregister services
PeerEnd.prototype.unregister = function(svrName, callback) {
  var cb = callback || function() {};
  if(typeof this._svrList[svrName] === 'undefined')
    cb('Service is not registered.');
  this._svrList[svrName] = null;
  delete this._svrList[svrName];
  console.log(svrName, 'unregistered OK!');
  cb(null);
}

var stub = null;
(function main() {
  var peer = new PeerEnd();
  // register PeerEnd on local IPC framework to be a service
  stub = Stub.getStub(peer);
})();

