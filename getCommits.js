'use strict'
var Promise = require('bluebird')
var git = require('nodegit')

function getBlobIDInDiffs (diffs, newPath) {
  for (var diffNr = 0; diffNr < diffs.length; diffNr++) {
    var diff = diffs[diffNr]
    var deltas = diff.numDeltas()
    for (var deltaNr = 0; deltaNr < deltas; deltaNr++) {
      var delta = diff.getDelta(deltaNr)
      if (newPath === delta.newFile().path()) {
        return delta.newFile().id()
      }
    }
  }
  return null
}

function stepCommit (options, historyEntry, context) {
  var newPath = historyEntry.newName || context.path
  return options.repo
    .getCommit(historyEntry.commit.sha())
    .then(function (commit) {
      return commit.getDiff()
        .then(function (diffs) {
          var blobId = getBlobIDInDiffs(diffs, newPath)
          if (blobId === null) {
            return Promise.reject(new Error('No diff for ' + newPath + ' found in commit ' + commit.sha()))
          }
          return {
            time: commit.date().getTime(),
            sha: commit.sha(),
            message: commit.message(),
            path: newPath,
            blobId: blobId.toString()
          }
        })
    })
}

function stepCommits (options, historyEntries, context) {
  var historyEntry = historyEntries.shift()
  return stepCommit(options, historyEntry, context)
    .then(function (commitInfo) {
      if (historyEntry.oldName && historyEntry.oldName !== context.path) {
        context.path = historyEntry.oldName
        return getCommits(options, context, historyEntry.commit.sha())
      }
      context.commits.push(commitInfo)
      if (historyEntries.length > 0) {
        return stepCommits(options, historyEntries, context)
      }
      return Promise.resolve(context.commits)
    })
}

function getCommits (options, context, commit) {
  var limit = options.limit || 2147483647 // 2^31 - 1 ... maximum acceptable value by git
  var walker = options.repo.createRevWalk()
  walker.sorting(git.Revwalk.SORT.TIME)
  if (commit) {
    walker.push(commit)
  } else {
    walker.pushHead()
  }
  return walker
    .fileHistoryWalk(context.path, limit)
    .then(function (historyEntries) {
      if (historyEntries.length === 0) {
        var err = new Error('ENOENT: file does not exist in repository \'' + context.path + '\'')
        err.code = 'ENOENT'
        err.file = context.path
        return Promise.reject(err)
      }
      return stepCommits(options, historyEntries, context)
    })
}

module.exports = function (options, path) {
  var context = {
    path: path,
    commits: []
  }
  return getCommits(options, context, null)
}
