const app = require("../dist/index.js");

module.exports = app && app.default ? app.default : app;
