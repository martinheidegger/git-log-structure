'use strict'
const git = require('nodegit')
const last = require('lodash.last')

function toStoryObject (value, commit) {
  if (typeof value === 'object' && value !== null) {
    var keys = Object.keys(value)
    var keyLength = keys.length
    if (keyLength > 0) {
      var tree = {}
      for (var i = 0; i < keyLength; i++) {
        var key = keys[i]
        // TODO: recursive check
        tree[key] = toStoryObject(value[key], commit)
      }
      return {
        tree: tree,
        history: [{type: 'added', commit: commit}]
      }
    }
  }
  return {
    value: value,
    history: [{type: 'added', commit: commit}]
  }
}

function addStory (result, newStory, previousCommit, parent, key) {
  var before
  if (!newStory) {
    // Nothing to do here, the result was added before
  } else if (result.tree) {
    if (!newStory.tree) {
      before = last(result.history)
      before.type = 'expanded'
      before.from = newStory.value
      result.history.push(newStory.history[0])
    } else {
      var foundKeys = Object
        .keys(result.tree)
        .reduce(function (foundKeys, resultKey) {
          foundKeys[resultKey] = true
          addStory(result.tree[resultKey], newStory.tree[resultKey], previousCommit, result, resultKey)
          return foundKeys
        }, {})
      Object
        .keys(newStory.tree)
        .filter(function (newStoryKey) {
          return !foundKeys[newStoryKey]
        })
        .forEach(function (newStoryKey) {
          result.tree[newStoryKey] = {
            value: undefined,
            history: [
              {type: 'deleted', commit: previousCommit, from: newStory.tree[newStoryKey]},
              newStory.history[0]
            ]
          }
        })
      before = last(result.history)
      before.commit++
    }
  } else if (newStory.tree) {
    before = last(result.history)
    before.type = 'reduced'
    before.from = newStory.tree
    result.history.push(newStory.history[0])
  } else if (result.value !== newStory.value) {
    var beforeBefore = result.history[result.history.length - 2]
    if (!beforeBefore || beforeBefore.type !== 'modified' || beforeBefore.from !== newStory.value) {
      before = last(result.history)
      before.type = 'modified'
      before.from = newStory.value
      result.history.push(newStory.history[0])
    } else {
      before = last(result.history)
      before.commit++
    }
  } else {
    before = last(result.history)
    before.commit++
  }
}

function commitInfo (commit) {
  return {
    time: commit.date().getTime(),
    sha: commit.sha(),
    message: commit.message()
  }
}

function createParseError (path, err, commit, result) {
  var parseErr = new Error('EPARSE: Error while parsing: ' + path + '\n  ' + err.message)
  parseErr.stack = parseErr.stack + '\n' + err.stack
  parseErr.code = 'EPARSE'
  parseErr.name = 'ParseError'
  parseErr.commit = commitInfo(commit)
  parseErr.result = result // Result is passed to catch handler for the oldPath!
  return parseErr
}

function parseBlob (oldPath, newPath, parser, commit, result, blob) {
  return new Promise(function (resolve, reject) {
    // This is run in a Promise context in order to make sure that any
    // error returned from the parser or blob.content() is caught
    resolve(parser(newPath, blob.content()))
  }).catch(function (err) {
    result.path = oldPath
    return Promise.reject(createParseError(newPath, err, commit, result))
  })
}

function processCommit (options, historyEntry, commit, result) {
  var newPath = historyEntry.newName || result.path
  var oldPath = historyEntry.oldName || result.path
  return commit.getDiff()
    .then(function (diffs) {
      for (var diffNr = 0; diffNr < diffs.length; diffNr++) {
        var diff = diffs[diffNr]
        var deltas = diff.numDeltas()
        for (var deltaNr = 0; deltaNr < deltas; deltaNr++) {
          var delta = diff.getDelta(deltaNr)
          if (newPath === delta.newFile().path()) {
            var id = delta.newFile().id()
            return options.repo.getBlob(id)
              .then(parseBlob.bind(null, oldPath, newPath, options.parser, commit, result))
              .then(function (data) {
                var story = toStoryObject(data, result.commits ? result.commits.length : 0)
                if (!result.commits) {
                  story.path = result.path
                  story.commits = []
                  result = story
                } else {
                  addStory(result, story, result.commits.length - 1)
                }
                result.commits.push(commitInfo(commit))
                result.path = oldPath
                return result
              })
          }
        }
      }
      return Promise.reject(new Error('No diff for ' + result.path + ' found in commit ' + commit.sha()))
    })
}

function processHistoryEntries (options, historyEntries, result) {
  if (historyEntries.length === 0) {
    return result.commits ? result : null
  } else {
    var errorMemo = null
    var historyEntry = historyEntries.shift()
    var formerPath = result.path
    return options.repo
      .getCommit(historyEntry.commit.sha())
      .then(function (commit) {
        return processCommit(options, historyEntry, commit, result)
      })
      .catch(function (error) {
        errorMemo = error
        var errResult = error.result
        delete error.result
        return errResult || result
      })
      .then(function (newResult) {
        // Recursive! Weeee
        if (errorMemo) {
          var errors = result.errors
          if (!errors) {
            errors = result.errors = []
          }
          errors.push(errorMemo)
        }
        if (newResult.path !== formerPath) {
          newResult.history.splice(newResult.commits.length - 2, 0, {
            type: 'moved',
            oldPath: newResult.path,
            commit: newResult.commits.length - 1
          })
          return walkPath(options, newResult, last(newResult.commits).sha, true)
        }
        return processHistoryEntries(options, historyEntries, newResult) || newResult
      })
      .then(function (newResult) {
        if (!newResult.history && errorMemo) {
          return Promise.reject(errorMemo)
        }
        return newResult
      })
  }
}
function walkPath (options, result, commit, skip) {
  var walker = options.repo.createRevWalk()
  walker.sorting(git.Revwalk.SORT.TIME)
  if (commit) {
    walker.push(commit)
  } else {
    walker.pushHead()
  }
  return walker
    .fileHistoryWalk(result.path, options.limit)
    .then(function (historyEntries) {
      if (historyEntries.length === 0) {
        var err = new Error('ENOENT: file does not exist in repository \'' + result.path + '\'')
        err.code = 'ENOENT'
        return Promise.reject(err)
      }
      if (skip) {
        historyEntries.shift()
      }
      return processHistoryEntries(options, historyEntries, result)
    })
}

function compileWithRepo (filePath, options) {
  return walkPath(options, { path: filePath }, null, false)
    .then(function (story) {
      // The story's path changes during the walkPath operation
      // After everything is done lets reset it to original path
      story.path = filePath
      return story
    })
}

// TODO: Option to ignore "deleted" properties
// TODO: Option to limit the history steps (tricky in combination with ignoring deleted properties)
// TODO: Option for multiple files with optimized commit-loading behaviour
module.exports = function compile (filePath, options) {
  options = options || {}
  options.parser = options.parser || require('./defaultParser.js')
  options.limit = options.limit || 2147483647 // 2^31 - 1 ... maximum acceptable value by git

  var repo = options.repo
  if (!repo) {
    return git.Repository.open('.')
      .then(function (repo) {
        options.repo = repo
        return compileWithRepo(filePath, options)
      })
  }
  return compileWithRepo(filePath, options)
}
