
// Create our own local controller service.
// We have namespaced local services with "hello:"
var shareControllerService = SYMPHONY.services.register('hello:controller');

// All Symphony services are namespaced with SYMPHONY
SYMPHONY.remote.hello().then(function(data) {

    // Register our application with the Symphony client:
    // Subscribe the application to remote (i.e. Symphony's) services
    // Register our own local services
    SYMPHONY.application.register('hello', ['share'], ['hello:controller']).then(function(response) {

        // The userReferenceId is an anonymized random string that can be used for uniquely identifying users.
        // The userReferenceId persists until the application is uninstalled by the user.
        // If the application is reinstalled, the userReferenceId will change.
        //var userId = response.userReferenceId;

        // Subscribe to Symphony's services
        var shareService = SYMPHONY.services.subscribe('share');

        // Implement some methods on our local service. These will be invoked by user actions.
        shareControllerService.implement({
            // currently nothing implemented
        });

        // all possible state for our state machine
        var STATES = Object.freeze({
            'findPort': 1,
            'encryptHandshake': 2,
            'getSessionToken': 3,
            'connectWS': 4,
            'connectedWS': 5
        });

        // current state of our state machine
        var state;

        var symphonyDevKey;

        // obtained from state: findPort
        var MIN_PORT=9000;
        var MAX_PORT=9005;
        var port = MIN_PORT;

        // obtained from state: 'encryptHandshake'

        var HS_BASE_URL = 'http://127.0.0.1';
        var WS_BASE_URL = 'ws://127.0.0.1';

        // obtained from state 'getSessionToken'
        var sessionToken;

        function nextState(newState) {
            if (newState === state) {
                return;
            }

            state = newState;

            console.log('new State=', state);

            switch(newState) {
                case STATES.findPort:
                    findPort();
                break;
                case STATES.encryptHandshake:
                    doEncryptHandshake();
                break;

                case STATES.getSessionToken:
                default:
                    getSessionToken();
                break;

                case STATES.connectWS:
                    connectToWebSocket();
                break;

                case STATES.connectedWS:
                    // nothing to do, event WS event listeners handle events
                break;
            }
        }

        function send(url, payload) {
            return new Promise(function(resolve, reject) {
                var type = payload ? 'POST' : 'GET';
                var xhr = new XMLHttpRequest();
                xhr.open(type, url, true);
                xhr.onload = function() {
                    resolve(xhr.responseText);
                }
                xhr.onerror = function() {
                    reject(xhr.statusText);
                }
                if (payload) {
                    xhr.setRequestHeader('Content-type', 'application/json');
                    var jsonPayload = JSON.stringify(payload);
                    xhr.send(jsonPayload);
                } else {
                    xhr.send();
                }
            });
        }

        var findPortTimeout;

        function findPort() {
            // scan port starting at MIN_PORT
            // if found then move to state 'encryptHandShake'
            // if not found, then increment port and scan again
            // if MAX_PORT reached then timeout and retry later.

            clearTimeout(findPortTimeout);

            send(HS_BASE_URL + ':' + port + '/ping')
            .then(function(portResp) {
                // check for success
                if (portResp == port) {
                    nextState(STATES.encryptHandshake);
                } else {
                    throw new Error('invalid port response: ' + portResp);
                }
            })
            .catch(function(err) {
                // fail: try another port
                var timeout;
                port++;
                console.error('failed to ping: ' + err + ' trying next port: ' + port);
                if (port > MAX_PORT) {
                    port = MIN_PORT;
                    timeout = 30000;
                } else {
                    timeout = 1000;
                }
                clearTimeout(findPortTimeout);
                findPortTimeout = setTimeout(findPort, timeout);
            });
        }

        function doEncryptHandshake() {
            nextState(STATES.getSessionToken);
        }

        function getSessionToken() {
            var payload = {
                command: 'handshake',
                productId: 'xyz',
                apiKey: '123'

            };
            send(HS_BASE_URL + ':' + port + '/sxs/v1', payload)
            .then(function(resp) {
                // success - maybe?
                var result = JSON.parse(resp);
                if (result && result.isSuccess && result.sessionToken) {
                    sessionToken = result.sessionToken;
                    nextState(STATES.connectWS);
                } else {
                    var err = result && result.error;
                    throw new Error('invalid resp when getting session token:' + err);
                }
            })
            .catch(function(err) {
                console.error('failed to get session token: ' + err);
                nextState(STATES.findPort);
            });
        }

        function share(title, context, appURI, image) {
            // Note: if calling share when share dialog in progress, will
            // replace existing dialog.
            // shareService.share(
            //     'article',
            //     articleOptions
            // );
            console.log('sharing... title:' + title + ' context:', context + ' appURI:' + appURI);
        }

        function connectToWebSocket() {

            // Create WebSocket connection.
            const socket = new WebSocket(WS_BASE_URL + ':' + port + '/sxs/v1/notifications?sessionToken=' + sessionToken);

            // Connection opened
            socket.addEventListener('open', function (event) {
                nextState(STATES.connectedWS);
            });

            socket.addEventListener('error', function() {
                nextState(STATES.findPort);
            });

            socket.addEventListener('close', function() {
                nextState(STATES.findPort);
            });

            // Listen for messages
            socket.addEventListener('message', function (event) {
                console.log('Message from server', event.data);
                if (event && event.data) {
                    try {
                        var msg = JSON.parse(event.data);
                        if (msg && msg.command === 'shareApp') {
                            share(msg.title, msg.context, msg.appURI, msg.image);
                        }
                    } catch (e) {
                        console.error('can not parse message event.date:' + event.data)
                    }
                }
            });
        }

        nextState(STATES.findPort);

    }.bind(this))
}.bind(this));
