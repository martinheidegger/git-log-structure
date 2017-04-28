'use strict'
var test = require('tap').test
var getRepo = require('../getRepo.js')
var getCommits = require('../getCommits')
var defaultAuthor = {
  email: "martin.heidegger@gmail.com",
  name: "Martin Heidegger"
}

function testCommits (path, limit) {
  return getRepo()
    .then(function (repo) {
      return getCommits({
        repo: repo,
        limit: limit
      }, path)
    })
}

test('simple', function (t) {
  return testCommits('test/data/simple/test.json')
    .then(function (commits) {
      t.deepEqual(commits, [{
        time: 1463654010000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: 'f5524546a0dba7a21d30055e0113e7e76225f0ac',
        message: 'Added test json file\n',
        path: 'test/data/simple/test.json',
        blobId: '27d5db50b5c3ced757fff6f6a29b3700432444e0'
      }])
    })
})

test('renamed', function (t) {
  return testCommits('test/data/renamed/test.json')
    .then(function (commits) {
      t.deepEqual(commits, [{
        time: 1472810319000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: 'e8cb8c4a33566a4d977011a325f7d07c161fa126',
        message: 'Moved changed file to a new name\n',
        path: 'test/data/renamed/test.json',
        blobId: 'b6c154f73c78b2045e013760297d04ef4c90e410'
      }, {
        time: 1472810281000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: 'a8d3846f585ae85a6d899b23487d870d31c9023a',
        message: 'Changed file that will be moved\n',
        path: 'test/data/renamed/test-a.json',
        blobId: 'b6c154f73c78b2045e013760297d04ef4c90e410'
      }, {
        time: 1472810249000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: '0310fbb4aed29d91e7373b94b323a58afaab4d26',
        message: 'Added file that will be changed and then removed.\n',
        path: 'test/data/renamed/test-a.json',
        blobId: '8a47294bb2ad01ec94f809f638ff4cd79043d0dd'
      }])
    })
})

test('multiple renames', function (t) {
  return testCommits('test/data/multiple-renamings/test.json')
    .then(function (commits) {
      t.deepEqual(commits, [{
        time: 1472827801000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: 'ce5949afe2f306a8cc815501af26c59218f52dba',
        message: 'Modified the final test once more (for good measure)\n',
        path: 'test/data/multiple-renamings/test.json',
        blobId: 'aeee994d6c904586a64b371f1791475ede299965'
      }, {
        time: 1472822980000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: '7e1195e6f6edb970a2c1a388558349a6026eaa4e',
        message: 'Renamed once more for fitting in test cases\n',
        path: 'test/data/multiple-renamings/test.json',
        blobId: 'd21d8ce7011f7c3365e4a8a9801d629acfe6d150'
      }, {
        time: 1472822878000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: '99f117b57d8da1f116831a855cf29d88d9659c60',
        message: 'Renamed in opposite order to make sure that the sorting isn\'t off\n',
        path: 'test/data/multiple-renamings/test-x.json',
        blobId: 'd21d8ce7011f7c3365e4a8a9801d629acfe6d150'
      }, {
        time: 1472822841000,
        author: defaultAuthor,
        committer: defaultAuthor,
        sha: '129fae56ed3c71424c8747d723b9f50a53beadce',
        message: 'Added multiple files to be renamed.\n',
        path: 'test/data/multiple-renamings/test-c.json',
        blobId: 'd21d8ce7011f7c3365e4a8a9801d629acfe6d150'
      }])
    })
})

test('unknown file', function (t) {
  return testCommits('test/no-file')
    .then(function () {
      t.fail('Shouldnt succeed')
    })
    .catch(function (err) {
      t.equals(err.code, 'ENOENT')
      t.equals(err.file, 'test/no-file')
    })
})
