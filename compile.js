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

function addStory (fileStory, newStory, previousCommit, parent, key) {
  var before
  if (!newStory) {
    // Nothing to do here, the fileStory was added before
  } else if (fileStory.tree) {
    if (!newStory.tree) {
      before = last(fileStory.history)
      before.type = 'expanded'
      before.from = newStory.value
      fileStory.history.push(newStory.history[0])
    } else {
      var foundKeys = Object
        .keys(fileStory.tree)
        .reduce(function (foundKeys, resultKey) {
          foundKeys[resultKey] = true
          addStory(fileStory.tree[resultKey], newStory.tree[resultKey], previousCommit, fileStory, resultKey)
          return foundKeys
        }, {})
      Object
        .keys(newStory.tree)
        .filter(function (newStoryKey) {
          return !foundKeys[newStoryKey]
        })
        .forEach(function (newStoryKey) {
          fileStory.tree[newStoryKey] = {
            value: undefined,
            history: [
              {type: 'deleted', commit: previousCommit, from: newStory.tree[newStoryKey]},
              newStory.history[0]
            ]
          }
        })
      before = last(fileStory.history)
      before.commit++
    }
  } else if (newStory.tree) {
    before = last(fileStory.history)
    before.type = 'reduced'
    before.from = newStory.tree
    fileStory.history.push(newStory.history[0])
  } else if (fileStory.value !== newStory.value) {
    var beforeBefore = fileStory.history[fileStory.history.length - 2]
    if (!beforeBefore || beforeBefore.type !== 'modified' || beforeBefore.from !== newStory.value) {
      before = last(fileStory.history)
      before.type = 'modified'
      before.from = newStory.value
      fileStory.history.push(newStory.history[0])
    } else {
      before = last(fileStory.history)
      before.commit++
    }
  } else {
    before = last(fileStory.history)
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

function createParseError (path, err, commit, fileStory) {
  var parseErr = new Error('EPARSE: Error while parsing: ' + path + '\n  ' + err.message)
  parseErr.stack = parseErr.stack + '\n' + err.stack
  parseErr.code = 'EPARSE'
  parseErr.name = 'ParseError'
  parseErr.commit = commitInfo(commit)
  parseErr.fileStory = fileStory // fileStory is passed to catch handler for the oldPath!
  return parseErr
}

function parseBlob (oldPath, newPath, parser, commit, fileStory, blob) {
  return new Promise(function (resolve, reject) {
    // This is run in a Promise context in order to make sure that any
    // error returned from the parser or blob.content() is caught
    resolve(parser(newPath, blob.content()))
  }).catch(function (err) {
    fileStory.path = oldPath
    return Promise.reject(createParseError(newPath, err, commit, fileStory))
  })
}

function processCommit (options, historyEntry, commit, fileStory) {
  var newPath = historyEntry.newName || fileStory.path
  var oldPath = historyEntry.oldName || fileStory.path
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
              .then(parseBlob.bind(null, oldPath, newPath, options.parser, commit, fileStory))
              .then(function (data) {
                var story = toStoryObject(data, fileStory.commits ? fileStory.commits.length : 0)
                if (!fileStory.commits) {
                  story.path = fileStory.path
                  story.commits = []
                  fileStory = story
                } else {
                  addStory(fileStory, story, fileStory.commits.length - 1)
                }
                fileStory.commits.push(commitInfo(commit))
                fileStory.path = oldPath
                return fileStory
              })
          }
        }
      }
      return Promise.reject(new Error('No diff for ' + fileStory.path + ' found in commit ' + commit.sha()))
    })
}

function processHistoryEntries (options, historyEntries, fileStory) {
  if (historyEntries.length === 0) {
    return fileStory.commits ? fileStory : null
  } else {
    var errorMemo = null
    var historyEntry = historyEntries.shift()
    var formerPath = fileStory.path
    return options.repo
      .getCommit(historyEntry.commit.sha())
      .then(function (commit) {
        return processCommit(options, historyEntry, commit, fileStory)
      })
      .catch(function (error) {
        errorMemo = error
        var errFileStory = error.fileStory
        delete error.fileStory
        return errFileStory || fileStory
      })
      .then(function (newStory) {
        // Recursive! Weeee
        if (errorMemo) {
          var errors = fileStory.errors
          if (!errors) {
            errors = fileStory.errors = []
          }
          errors.push(errorMemo)
        }
        if (newStory.path !== formerPath) {
          newStory.history.splice(newStory.commits.length - 2, 0, {
            type: 'moved',
            oldPath: newStory.path,
            commit: newStory.commits.length - 1
          })
          return walkPath(options, newStory, last(newStory.commits).sha, true)
        }
        return processHistoryEntries(options, historyEntries, newStory) || newStory
      })
      .then(function (newStory) {
        if (!newStory.history && errorMemo) {
          return Promise.reject(errorMemo)
        }
        return newStory
      })
  }
}
function walkPath (options, fileStory, commit, skip) {
  var walker = options.repo.createRevWalk()
  walker.sorting(git.Revwalk.SORT.TIME)
  if (commit) {
    walker.push(commit)
  } else {
    walker.pushHead()
  }
  return walker
    .fileHistoryWalk(fileStory.path, options.limit)
    .then(function (historyEntries) {
      if (historyEntries.length === 0) {
        var err = new Error('ENOENT: file does not exist in repository \'' + fileStory.path + '\'')
        err.code = 'ENOENT'
        return Promise.reject(err)
      }
      if (skip) {
        historyEntries.shift()
      }
      return processHistoryEntries(options, historyEntries, fileStory)
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
