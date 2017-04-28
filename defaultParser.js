'use strict'
var jsYaml
const path = require('path')

function parse (filePath, blob) {
  if (/\.ya?ml$/ig.test(path.extname(filePath))) {
    if (!jsYaml) {
      jsYaml = require('js-yaml')
    }
    return jsYaml.load(blob.toString())
  }
  return JSON.parse(blob)
}

module.exports = function (filePath, blob) {
  try {
    return Promise.resolve(parse(filePath, blob))
  } catch (e) {
    return Promise.reject(e)
  }
}
