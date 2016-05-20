'use strict'
var git = require('nodegit')

function getRepo (path, repo) {
  if (repo) {
    return Promise.resolve(repo)
  }
  return git.Repository.open('.')
}

module.exports = function compile (path, repo) {
  return getRepo(path, repo)
    .then(function (repo) {
      return repo.getHeadCommit()
    })
    .then(function (commit) {
      var commitDate = commit.date()
      return commit.getEntry(path)
        .then(function (entry) {
          return entry.getBlob()
        })
        .then(function (blob) {
          var data = JSON.parse(blob.content())
          return Object
            .keys(data)
            .reduce(function (output, key) {
              output[key] = [{type: 'added', time: commitDate.getTime()}]
              return output
            }, {})
        })
    })
}
