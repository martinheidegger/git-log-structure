'use strict'
var test = require('tap').test
var compile = require('../compile')
var path = require('path')
var fs = require('fs')

function compareCompiled (t, target) {
  var expected = JSON.parse(fs.readFileSync(path.join(__dirname, target, 'expected.json')))
  return compile('test/' + target + '/test.json')
    .then(function (data) {
      t.deepEqual(data, expected)
      t.end()
    })
    .catch(function (err) {
      console.log(err)
      t.fail(err)
      t.end()
    })
}


test('A simple file in a repo should have the same age for all properties', function (t) {
  return compareCompiled(t, 'data/simple')
})
test('A simple file in a repo with a tree have the same age for all properties', function (t) {
  return compareCompiled(t, 'data/simple_with_tree')
})
test('A simple file in a repo with an added property', function (t) {
  return compareCompiled(t, 'data/simple_added')
})
test('A simple file in a repo with an removed property', function (t) {
  return compareCompiled(t, 'data/simple_removed')
})
test('A simple file in a repo with an changed property', function (t) {
  return compareCompiled(t, 'data/simple_modified')
})
test('A simple file in a repo with a twice changed property', function (t) {
  return compareCompiled(t, 'data/simple_modified_twice')
})
test('A simple file in a repo with an expanded property', function (t) {
  return compareCompiled(t, 'data/simple_expanded')
})
test('A simple file in a repo with a reduced property', function (t) {
  return compareCompiled(t, 'data/simple_reduced')
})
test('A renamed file', function (t) {
  return compareCompiled(t, 'data/renamed')
})
test('A file that never existed', function (t) {
  return compile('data/never_existed/test.json')
    .then(function (data) {
      t.fail(new Error('Returned successfully, even though it is supposed to never have existed.'))
      t.end()
    })
    .catch(function (err) {
      console.log(err.stack)
      t.equal(err.code, 'ENOENT')
      t.end()
    })
})

