'use strict'
var test = require('tap').test
var compile = require('../compile')

test('A simple file in a repo should have the same age for all properties', function (t) {
  return compile('test/data/simple/test.json').then(function (data) {
    console.log('data')
    t.deepEqual(data, {
      a: [
        {type: 'added', time: 1463654010000}
      ],
      b: [
        {type: 'added', time: 1463654010000}
      ]
    })
    t.end()
  })
})
