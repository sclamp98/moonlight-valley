/* Moonlight Valley — cinema settings. Edit this file; it is the only place Google settings go.

   googleClientId   the OAuth "Client ID" of YOUR Google Cloud project (type: Web application). It looks like
                    1234567890-abcdefg.apps.googleusercontent.com. A client ID is public by design; there is no client secret
                    in this game and none must ever be added here. Leave it empty to turn Google Drive playback off
                    (YouTube keeps working). Setup steps: cinema/DRIVE_SETUP.md

   driveApiBase     only change this for testing against a stand-in server.

   iceServers       optional: replace the default STUN servers, e.g. add your own TURN relay for networks that block direct
                    connections:  [{urls:"stun:stun.l.google.com:19302"}, {urls:"turn:YOUR-HOST:3478", username:"…", credential:"…"}]
                    (TURN credentials are visible to anyone who opens the page; only use credentials meant to be shared.)
   connectWatchdogMs  how long a co-op connection may take before the game explains why it is stuck (default 20000). */
window.CINEMA_CONFIG = Object.assign({
  googleClientId: "934053019434-1v074949ruco04h41a6jt6594ohbfbhb.apps.googleusercontent.com",   // public OAuth identifier (not a secret)
  driveApiBase: "https://www.googleapis.com",
}, window.CINEMA_CONFIG || {});
