{
  "name": "google-ai-catalyst",
  "version": "1.0.0",
  "description": "Google AI Catalyst — Express + Postgres backend for the enterprise AI use-case evaluation workflow.",
  "main": "server.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node server.js",
    "migrate": "node scripts/migrate.js",
    "test": "node --test *.test.js",
    "test:api": "node server.test.js",
    "test:intake": "node intake.test.js",
    "test:bxt": "node bxt.test.js",
    "test:feasibility": "node feasibility.test.js",
    "test:advisory": "node advisory.test.js",
    "test:summary": "node summary.test.js",
    "test:panel": "node panel.test.js",
    "test:deeplink": "node deep-link.test.js && node deep-link-integration.test.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "jsdom": "^24.0.0"
  }
}
