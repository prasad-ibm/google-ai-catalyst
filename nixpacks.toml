[phases.setup]
nixPkgs = ["nodejs_20"]

[phases.install]
cmds = ["npm ci --omit=dev || npm install --omit=dev"]

[phases.build]
# No build step needed for this app (static HTML + Node server).
cmds = ["echo 'no build step'"]

[start]
cmd = "npm start"
