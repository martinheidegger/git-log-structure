'use strict'
var test = require('tap').test
var compile = require('../compile')

test('A simple file in a repo should have the same age for all properties', function (t) {
  return compile('test/data/simple/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          value: 1,
          history: [{type: 'added', time: 1463654010000}]
        },
        b: {
          value: 2,
          history: [{type: 'added', time: 1463654010000}]
        }
      },
      history: [{type: 'added', time: 1463654010000}]
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
test('A simple file in a repo with a tree have the same age for all properties', function (t) {
  return compile('test/data/simple_with_tree/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          tree: {
            b: {
              tree: {
                c: {
                  value: 1,
                  history: [{type: 'added', time: 1463703348000}] 
                }
              },
              history: [{type: 'added', time: 1463703348000}]
            }
          },
          history: [{type: 'added', time: 1463703348000}]
        },
        d: {
          value: {},
          history: [{type: 'added', time: 1463703348000}]
        }
      },
      history: [{type: 'added', time: 1463703348000}] 
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
test('A simple file in a repo with an added property', function (t) {
  return compile('test/data/simple_added/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          value: 1,
          history: [{type: 'added', time: 1472745051000}]
        },
        b: {
          value: 2,
          history: [{type: 'added', time: 1472745086000}]
        }
      },
      history: [{type: 'added', time: 1472745051000}] 
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
test('A simple file in a repo with an removed property', function (t) {
  return compile('test/data/simple_removed/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          value: 1,
          history: [{type: 'added', time: 1472750088000}]
        },
        b: {
          value: undefined,
          history: [
            {type: 'deleted', time: 1472750102000, from: {
              history: [{type: 'added', time: 1472750088000}],
              value: 2
            }},
            {type: 'added', time: 1472750088000}
          ]
        }
      },
      history: [{type: 'added', time: 1472750088000}] 
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
