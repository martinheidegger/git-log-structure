'use strict'
var test = require('tap').test
var compile = require('../compile')

test('A simple file in a repo should have the same age for all properties', function (t) {
  return compile('test/data/simple/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          value: 1,
          history: [{type: 'added', commit: 0}]
        },
        b: {
          value: 2,
          history: [{type: 'added', commit: 0}]
        }
      },
      commits:  [
        {
          time: 1463654010000,
          sha: 'f5524546a0dba7a21d30055e0113e7e76225f0ac',
          message: 'Added test json file\n'
        }
      ],
      history: [{type: 'added', commit: 0}]
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
                  history: [{type: 'added', commit: 0}] 
                }
              },
              history: [{type: 'added', commit: 0}]
            }
          },
          history: [{type: 'added', commit: 0}]
        },
        d: {
          value: {},
          history: [{type: 'added', commit: 0}]
        }
      },
      history: [{type: 'added', commit: 0}],
      commits: [
        {
          time: 1463703348000,
          sha: '014162ca5a9309181e6ef29aad61461df9ccc9d2',
          message: 'Added simple test with tree file.\n'
        }
      ]
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
          history: [{type: 'added', commit: 1}]
        },
        b: {
          value: 2,
          history: [{type: 'added', commit: 0}]
        }
      },
      history: [{type: 'added', commit: 1}],
      commits: [
        {
          time: 1472745086000,
          sha: 'b698c48ce6039aff453e47791de71e01ab68e532',
          message: 'second commit wth added fields\n'
        },
        {
          time: 1472745051000,
          sha: 'ccb6991ed1ed6d6126c12ccce658fa27a26ef803',
          message: 'first commit with two files\n'
        }]
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
          history: [{type: 'added', commit: 1}]
        },
        b: {
          value: undefined,
          history: [
            {type: 'deleted', commit: 0, from: {
              history: [{type: 'added', commit: 1}],
              value: 2
            }},
            {type: 'added', commit: 1}
          ]
        }
      },
      history: [{type: 'added', commit: 1}],
      commits: [
        {
          time: 1472750102000,
          sha: '11a429d8ff6582375bdcef677450031922b6a7c4',
          message: 'Removed one property of test file\n'
        },
        {
          time: 1472750088000,
          sha: '6db43685368d8e865572024fa46dfea9f6bad8cf',
          message: 'First commit of file which\'s property is going to be removed\n'
        }
      ] 
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
test('A simple file in a repo with an changed property', function (t) {
  return compile('test/data/simple_modified/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          value: 2,
          history: [
            {type: 'modified', commit: 0, from: 1},
            {type: 'added', commit: 1}
          ]
        }
      },
      history: [{type: 'added', commit: 1}],
      commits: [
        {
          time: 1472770859000,
          sha: '0310e11b7c21e045c865f25b3972f696cdf1a28a',
          message: 'Commit that modifies a test-file\n'
        },
        {
          time: 1472770835000,
          sha: '0de6359ab7d7c55fefaefd3b81cf79349724ea22',
          message: 'First commit of a file that is going to be modified once\n'
        }
      ]
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
test('A simple file in a repo with a twice changed property', function (t) {
  return compile('test/data/simple_modified/test.json').then(function (data) {
    t.deepEqual(data, {
      tree: {
        a: {
          value: 2,
          history: [
            {type: 'modified', commit: 0, from: 1},
            {type: 'added', commit: 1}
          ]
        }
      },
      history: [{type: 'added', commit: 1}],
      commits: [
        {
          time: 1472770859000,
          sha: '0310e11b7c21e045c865f25b3972f696cdf1a28a',
          message: 'Commit that modifies a test-file\n'
        },
        {
          time: 1472770835000,
          sha: '0de6359ab7d7c55fefaefd3b81cf79349724ea22',
          message: 'First commit of a file that is going to be modified once\n'
        }
      ]
    })
    t.end()
  }).catch((err) => {
    console.log(err)
    t.fail(err)
    t.end()
  })
})
