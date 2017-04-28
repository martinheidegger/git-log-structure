'use strict'
const reverse = require('lodash.reverse')
const Promise = require('bluebird')
const getRepo = require('./getRepo')
const getCommits = require('./getCommits')

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
  var before = nextEntry.history[0]
  before.type = 'expanded'
  before.from = currentEntry.value
  currentEntry.tree = nextEntry.tree
  delete currentEntry.value
  currentEntry.history.unshift(nextEntry.history[0])
}

function reduceToValue (storyEntry) {
  if (storyEntry.tree) {
    return Object.keys(storyEntry.tree).reduce(function (value, key) {
      value[key] = reduceToValue(storyEntry.tree[key])
      return value
    }, {})
  }
  return storyEntry.value
}

function addReductionToEntry (currentEntry, nextEntry) {
  // Reduction means that the history of the current entry
  // ends with a simple value but it used to be an object before
  var before = nextEntry.history[0]
  before.type = 'reduced'
  before.from = reduceToValue(currentEntry)
  currentEntry.value = nextEntry.value
  delete currentEntry.tree
  currentEntry.history.unshift(nextEntry.history[0])
}

function addModificationToEntry (currentEntry, nextEntry) {
  // Modification means that the current entry has a different simple
  // value than the next entry
  var before = nextEntry.history[0]
  before.type = 'modified'
  before.from = currentEntry.value
  currentEntry.value = nextEntry.value
  currentEntry.history.unshift(before)
}

function addDeletedEntry (currentEntry, nextParentEntry, key) {
  // A deleted entry means that an key existed in the next entry that
  // doesn't exist in the current entry
  currentEntry.history.unshift({
    type: 'deleted',
    commit: nextParentEntry.history[0].commit,
    from: currentEntry.value
  })
  delete currentEntry.value
}

function entryWasModified (currentEntry, nextEntry) {
  if (currentEntry.value === nextEntry.value) {
    return false
  }
  for (var i = currentEntry.history.length - 1; i >= 0; i--) {
    var before = currentEntry.history[i]
    if (before.type === 'modified') {
      return before.from !== nextEntry.value
    }
  }
  return true
}

function addStoryEntry (currentEntry, nextEntry, previousCommit, parent, key) {
  if (!nextEntry) {
    // Nothing to do here, the currentEntry was added before
    return
  }
  if (!currentEntry.tree && nextEntry.tree) {
    addExpansionToEntry(currentEntry, nextEntry)
    return
  }
  if (currentEntry.tree && !nextEntry.tree) {
    addReductionToEntry(currentEntry, nextEntry)
    return
  }
  if (currentEntry.tree) {
    var foundKeys = Object
      .keys(currentEntry.tree)
      .reduce(function (foundKeys, resultKey) {
        foundKeys[resultKey] = true
        if (currentEntry.tree[resultKey] && nextEntry.tree[resultKey] === undefined) {
          addDeletedEntry(currentEntry.tree[resultKey], nextEntry, resultKey)
          return foundKeys
        }
        addStoryEntry(currentEntry.tree[resultKey], nextEntry.tree[resultKey], currentEntry, resultKey)
        return foundKeys
      }, {})
    Object
      .keys(nextEntry.tree)
      .filter(function (nextEntryKey) {
        return foundKeys[nextEntryKey] !== true
      })
      .forEach(function (nextEntryKey) {
        currentEntry.tree[nextEntryKey] = nextEntry.tree[nextEntryKey]
      })
    return
  }
  if (entryWasModified(currentEntry, nextEntry)) {
    addModificationToEntry(currentEntry, nextEntry)
  }
}

function createParseError (path, err, commit, fileStory) {
  var parseErr = new Error('EPARSE: Error while parsing: ' + path + '\n  ' + err.message)
  parseErr.stack = parseErr.stack + '\n' + err.stack
  parseErr.code = 'EPARSE'
  parseErr.name = 'ParseError'
  parseErr.commit = commit
  delete commit.blobId
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

function processCommit (options, story, commit) {
  return options.repo.getBlob(commit.blobId)
    .then(function (blob) {
      var oldPath = story.path || commit.path
      story.path = commit.path
      if (oldPath !== story.path) {
        story.history.unshift({
          type: 'moved',
          oldPath: oldPath,
          commit: commit
        })
      }
      var errorMemo
      return parseBlob(oldPath, commit.path, options.parser, commit, story, blob)
        .then(function (data) {
          return toStoryObject(data, commit)
        })
        .then(function (nextStory) {
          if (story.history.length === 0) {
            // Replaces the whole fileStory with the story generated
            // (first story processed)
            return nextStory
          }
          addStoryEntry(story, nextStory)
          return story
        })
        .catch(function (error) {
          errorMemo = error
          var errFileStory = error.fileStory
          delete error.fileStory
          return errFileStory || story
        })
        .then(function (newStory) {
          if (errorMemo) {
            var errors = story.errors
            if (!errors) {
              errors = newStory.errors = []
            }
            errors.push(errorMemo)
          } else if (story.errors) {
            newStory.errors = story.errors
          }
          newStory.path = commit.path
          return newStory
        })
    })
}

function getAllCommits (story, commits) {
  if (!commits) {
    commits = new Set()
  }
  story.history.forEach(function (historyEntry) {
    const commit = historyEntry.commit
    if (!commits.has(commit)) {
      commits.add(commit)
    }
  })
  if (story.errors) {
    story.errors.forEach(function (error) {
      const commit = error.commit
      if (!commits.has(commit)) {
        commits.add(commit)
      }
    })
  }
  if (story.tree) {
    Object.keys(story.tree).forEach(function (treeKey) {
      getAllCommits(story.tree[treeKey], commits)
    })
  }
  return commits
}

function sortByTime (a, b) {
  if (a.time > b.time) return -1
  if (b.time > a.time) return 1
  return 0
}

function reduceCommits (story, commits, lookup) {
  if (!commits) {
    commits = Array.from(getAllCommits(story).values()).sort(sortByTime)
    lookup = commits.reduce(function (lookup, commit, index) {
      lookup.set(commit, index)
      return lookup
    }, new Map())
    story.commits = commits
  }
  story.history.forEach(function (historyEntry) {
    historyEntry.commit = lookup.get(historyEntry.commit)
  })
  if (story.errors) {
    story.errors.forEach(function (error) {
      error.commit = lookup.get(error.commit)
    })
  }
  if (story.tree) {
    Object.keys(story.tree).forEach(function (treeKey) {
      reduceCommits(story.tree[treeKey], commits, lookup)
    })
  }
}

function reducePaths (story) {
  if (story.commits.length > 0) {
    story.path = story.commits[0].path
    story.commits.forEach(function (commit) {
      delete commit.path
    })
  }
}

function reduceAuthor (lookup, authors, commit, field) {
  var author = commit[field]
  if (!lookup.has(author.email)) {
    lookup.set(author.email, authors.push(author) - 1)
  }
  commit[field] = lookup.get(author.email)
}

function reduceAuthors (story) {
  if (story.commits.length > 0) {
    var authors = []
    var lookup = new Map()
    story.commits.forEach(function (commit) {
      reduceAuthor(lookup, authors, commit, 'author')
      reduceAuthor(lookup, authors, commit, 'committer')
    }, new Map())
    story.authors = authors
  }
}

// TODO: Option to ignore "deleted" properties
// TODO: Option to limit the history steps (tricky in combination with ignoring deleted properties)
// TODO: Option for multiple files with optimized commit-loading behaviour
module.exports = function compile (filePath, options) {
  options = options || {}
  options.parser = options.parser || require('./defaultParser.js')
  options.limit = options.limit || 2147483647 // 2^31 - 1 ... maximum acceptable value by git

  return getRepo(options.repo, options.folder)
    .then(function (repo) {
      options.repo = repo
      return getCommits(options, filePath)
    })
    .then(function (commits) {
      var initialStory = {
        history: []
      }
      return Promise.reduce(reverse(commits), processCommit.bind(null, options), initialStory)
    })
    .then(function (finalStory) {
      reduceCommits(finalStory)
      reducePaths(finalStory)
      reduceAuthors(finalStory)
      // Todo: readd and test
      finalStory.commits.forEach(function (commit) {
        delete commit.blobId
      })
      return finalStory
    })
}
