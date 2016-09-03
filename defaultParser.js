'use strict'
var jsYaml
const path = require('path')

module.exports = function (filePath, blob) {
  if (/\.ya?ml$/ig.test(path.extname(filePath))) {
    if (!jsYaml) {
      jsYaml = require('js-yaml')
    }
    return jsYaml.load(blob.toString())
  }
  return JSON.parse(blob)
}
