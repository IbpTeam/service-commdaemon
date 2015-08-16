// Main function of this service
function onStart() {
  require('./implements/communication-daemon.js');
}

// Do not modify codes below!!

if(process.argv[2] == 'start') {
  onStart();
  // initialize some event handler
  process.on('SIGTERM', function() {
    console.log('SIGTERM recived');
    process.exit(0);
  }).on('SIGINT', function() {
    console.log('SIGINT recived');
    process.exit(0);
  });
} else {
  var svcmgr = require('webde-rpc').defaultSvcMgr();
  svcmgr.addService('nodejs.webde.commdaemon', {
    path: __dirname,
    args: ['start'],
    remote: false
  }, function(ret) {
    if(ret.err) {
      console.log(ret.err);
      process.exit(1);
    }
    process.exit(0);
  });
}
