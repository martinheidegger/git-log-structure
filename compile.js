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

function addExpansionToEntry (currentEntry, nextEntry) {
  // Expansion means that the history of the current entry
  // ends with an object but it used to be a simple value
  var before = last(currentEntry.history)
  before.type = 'expanded'
  before.from = nextEntry.value
  currentEntry.history.push(nextEntry.history[0])
}

function addReductionToEntry (currentEntry, nextEntry) {
  // Reduction means that the history of the current entry
  // ends with a simple value but it used to be an object before
  var before = last(currentEntry.history)
  before.type = 'reduced'
  before.from = nextEntry.tree
  currentEntry.history.push(nextEntry.history[0])
}

function skipCommit (currentEntry) {
  // Increments the commit count in order
  var before = last(currentEntry.history)
  before.commit++
}

function addModificationToEntry (currentEntry, nextEntry) {
  // Modification means that the current entry has a different simple
  // value than the next entry
  var before = last(currentEntry.history)
  before.type = 'modified'
  before.from = nextEntry.value
  currentEntry.history.push(nextEntry.history[0])
}

function addDeletedEntry (currentEntry, nextEntry, previousCommit, nextEntryKey) {
  // A deleted entry means that an key existed in the next entry that
  // doesn't exist in the current entry
  currentEntry.tree[nextEntryKey] = {
    value: undefined,
    history: [
      {type: 'deleted', commit: previousCommit, from: nextEntry.tree[nextEntryKey]},
      nextEntry.history[0]
    ]
  }
}

function addStoryEntry (currentEntry, nextEntry, previousCommit, parent, key) {
  if (!nextEntry) {
    // Nothing to do here, the currentEntry was added before
  } else if (currentEntry.tree) {
    if (!nextEntry.tree) {
      addExpansionToEntry(currentEntry, nextEntry)
    } else {
      var foundKeys = Object
        .keys(currentEntry.tree)
        .reduce(function (foundKeys, resultKey) {
          foundKeys[resultKey] = true
          addStoryEntry(currentEntry.tree[resultKey], nextEntry.tree[resultKey], previousCommit, currentEntry, resultKey)
          return foundKeys
        }, {})
      Object
        .keys(nextEntry.tree)
        .filter(function (nextEntryKey) {
          return !foundKeys[nextEntryKey]
        })
        .forEach(function (nextEntryKey) {
          addDeletedEntry(currentEntry, nextEntry, previousCommit, nextEntryKey)
        })
      skipCommit(currentEntry)
    }
  } else if (nextEntry.tree) {
    addReductionToEntry(currentEntry, nextEntry)
  } else if (currentEntry.value !== nextEntry.value) {
    var beforeBefore = currentEntry.history[currentEntry.history.length - 2]
    if (!beforeBefore || beforeBefore.type !== 'modified' || beforeBefore.from !== nextEntry.value) {
      addModificationToEntry(currentEntry, nextEntry)
    } else {
      skipCommit(currentEntry)
    }
  } else {
    skipCommit(currentEntry)
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

function getBlobIDInDiffs (newPath, diffs) {
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

function getBlobInDiffs (repo, newPath, diffs) {
  var blobId = getBlobIDInDiffs(diffs, newPath)
  if (blobId === null) {
    return Promise.resolve(null)
  }
  return repo.getBlob(blobId)
}

function processCommit (options, historyEntry, commit, fileStory) {
  var newPath = historyEntry.newName || fileStory.path
  var oldPath = historyEntry.oldName || fileStory.path
  return commit.getDiff()
    .then(function (diffs) {
      return getBlobInDiffs(options.repo, diffs, newPath)
        .then(function (blob) {
          if (blob === null) {
            Promise.reject(new Error('No diff for ' + fileStory.path + ' found in commit ' + commit.sha()))
          }
          return parseBlob(oldPath, newPath, options.parser, commit, fileStory, blob)
        })
        .then(function (data) {
          var story = toStoryObject(data, fileStory.commits ? fileStory.commits.length : 0)
          if (!fileStory.commits) {
            story.path = fileStory.path
            story.commits = []
            fileStory = story
          } else {
            addStoryEntry(fileStory, story, fileStory.commits.length - 1)
          }
          fileStory.commits.push(commitInfo(commit))
          fileStory.path = oldPath
          return fileStory
        })
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
