'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

let loadPage = (() => {
  var _ref = _asyncToGenerator(function* (page, url, timeout, pageLoadSkipTimeout) {
    debuglog('page load start');
    // set a higher number than the timeout option, in order to make
    // puppeteer’s timeout _never_ happen
    let waitingForPageLoad = true;
    const loadPagePromise = page.goto(url, { timeout: timeout + 1000 });
    if (pageLoadSkipTimeout) {
      let response = yield Promise.race([loadPagePromise, new Promise(function (resolve) {
        // instead we manually _abort_ page load after X time,
        // in order to deal with spammy pages that keep sending non-critical requests
        // (tracking etc), which would otherwise never load.
        // With JS disabled it just shouldn't take that many seconds to load what's needed
        // for critical viewport.
        setTimeout(function () {
          if (waitingForPageLoad) {
            debuglog('page load waiting ABORTED after ' + pageLoadSkipTimeout / 1000 + 's. ');
            resolve();
          }
        }, pageLoadSkipTimeout);
      })]);
      if (response && response.status && ![200, 301].includes(response.status)) {
        throw new Error(`page responsed with disallowed status ${response.status}`);
      }
    } else {
      let response = yield loadPagePromise;
      if (response && response.status && ![200, 301].includes(response.status)) {
        throw new Error(`page responsed with disallowed status ${response.status}`);
      }
    }
    waitingForPageLoad = false;
    debuglog('page load DONE');
  });

  return function loadPage(_x, _x2, _x3, _x4) {
    return _ref.apply(this, arguments);
  };
})();

let astFromCss = (() => {
  var _ref2 = _asyncToGenerator(function* ({ cssString, strict }) {
    // breaks puppeteer
    const css = cssString.replace(/￿/g, '\f042');

    let parsingErrors = [];
    debuglog('parse ast START');
    let ast = _cssTree2.default.parse(css, {
      onParseError: function onParseError(error) {
        return parsingErrors.push(error.formattedMessage);
      }
    });
    debuglog(`parse ast DONE (with ${parsingErrors.length} errors)`);

    if (parsingErrors.length && strict === true) {
      // NOTE: only informing about first error, even if there were more than one.
      const parsingErrorMessage = parsingErrors[0];
      throw new Error(`AST parser (css-tree) found ${parsingErrors.length} errors in CSS.
      Breaking because in strict mode.
      The first error was:
      ` + parsingErrorMessage);
    }
    return ast;
  });

  return function astFromCss(_x5) {
    return _ref2.apply(this, arguments);
  };
})();

let preparePage = (() => {
  var _ref3 = _asyncToGenerator(function* ({
    page,
    width,
    height,
    browser,
    userAgent,
    customPageHeaders,
    blockJSRequests,
    cleanupAndExit,
    getHasExited
  }) {
    debuglog('preparePage START');
    try {
      page = yield browser.newPage();
    } catch (e) {
      if (getHasExited()) {
        // we already exited (strict mode css parsing erros)
        // - ignore
      } else {
        debuglog('unexpted: could not open browser page' + e);
      }
      return;
    }
    debuglog('new page opened in browser');

    const setViewportPromise = page.setViewport({ width, height }).then(function () {
      return debuglog('viewport set');
    });
    const setUserAgentPromise = page.setUserAgent(userAgent).then(function () {
      return debuglog('userAgent set');
    });

    let setCustomPageHeadersPromise;
    if (customPageHeaders) {
      try {
        setCustomPageHeadersPromise = page.setExtraHTTPHeaders(customPageHeaders).then(function () {
          return debuglog('customPageHeaders set');
        });
      } catch (e) {
        debuglog('failed setting extra http headers: ' + e);
      }
    }

    let blockJSRequestsPromise;
    if (blockJSRequests) {
      // NOTE: with JS disabled we cannot use JS timers inside page.evaluate
      // (setTimeout, setInterval), however requestAnimationFrame works.
      blockJSRequestsPromise = Promise.all([page.setJavaScriptEnabled(false), setupBlockJsRequests(page)]).then(function () {
        debuglog('blocking js requests DONE');
      });
    }

    page.on('error', function (error) {
      debuglog('page crashed: ' + error);
      cleanupAndExit({ error });
    });
    page.on('console', function (msg) {
      const text = msg.text || msg;
      // pass through log messages
      // - the ones sent by penthouse for debugging has 'debug: ' prefix.
      if (/^debug: /.test(text)) {
        debuglog(text.replace(/^debug: /, ''));
      }
    });
    debuglog('page event listeners set');

    return Promise.all([setViewportPromise, setUserAgentPromise, setCustomPageHeadersPromise, blockJSRequestsPromise]).then(function () {
      debuglog('preparePage DONE');
      return page;
    });
  });

  return function preparePage(_x6) {
    return _ref3.apply(this, arguments);
  };
})();

let grabPageScreenshot = (() => {
  var _ref4 = _asyncToGenerator(function* ({
    type,
    page,
    screenshots,
    screenshotExtension,
    debuglog
  }) {
    const path = screenshots.basePath + `-${type}` + screenshotExtension;
    debuglog(`take ${type} screenshot, START`);
    return page.screenshot(_extends({}, screenshots, {
      path
    })).then(function () {
      return debuglog(`take ${type} screenshot DONE, path: ${path}`);
    });
  });

  return function grabPageScreenshot(_x7) {
    return _ref4.apply(this, arguments);
  };
})();

let pruneNonCriticalCssLauncher = (() => {
  var _ref5 = _asyncToGenerator(function* ({
    browser,
    url,
    cssString,
    width,
    height,
    forceInclude,
    strict,
    userAgent,
    renderWaitTime,
    timeout,
    pageLoadSkipTimeout,
    blockJSRequests,
    customPageHeaders,
    screenshots,
    propertiesToRemove,
    maxEmbeddedBase64Length,
    keepLargerMediaQueries,
    unstableKeepBrowserAlive
  }) {
    let _hasExited = false;
    // hacky to get around _hasExited only available in the scope of this function
    const getHasExited = function getHasExited() {
      return _hasExited;
    };

    const takeScreenshots = screenshots && screenshots.basePath;
    const screenshotExtension = takeScreenshots && screenshots.type === 'jpeg' ? '.jpg' : '.png';

    return new Promise((() => {
      var _ref6 = _asyncToGenerator(function* (resolve, reject) {
        let cleanupAndExit = (() => {
          var _ref7 = _asyncToGenerator(function* ({ error, returnValue }) {
            if (_hasExited) {
              return;
            }
            debuglog('cleanupAndExit start');
            _hasExited = true;

            clearTimeout(killTimeout);
            // page.close will error if page/browser has already been closed;
            // try to avoid
            if (page && !(error && error.toString().indexOf('Target closed') > -1)) {
              debuglog('cleanupAndExit -> try to close browser page');
              // Without try/catch if error penthouse will crash if error here,
              // and wont restart properly
              try {
                // must await here, otherwise will receive errors if closing
                // browser before page is properly closed,
                // however in unstableKeepBrowserAlive browser is never closed by penthouse.
                if (unstableKeepBrowserAlive) {
                  page.close();
                } else {
                  yield page.close();
                }
              } catch (err) {
                debuglog('cleanupAndExit -> failed to close browser page (ignoring)');
              }
            }
            debuglog('cleanupAndExit end');
            if (error) {
              return reject(error);
            }
            return resolve(returnValue);
          });

          return function cleanupAndExit(_x11) {
            return _ref7.apply(this, arguments);
          };
        })();

        debuglog('Penthouse core start');
        let page;
        let killTimeout;

        killTimeout = setTimeout(function () {
          cleanupAndExit({
            error: new Error('Penthouse timed out after ' + timeout / 1000 + 's. ')
          });
        }, timeout);

        // 1. start preparing a browser page (tab) [NOT BLOCKING]
        const updatedPagePromise = preparePage({
          page,
          width,
          height,
          browser,
          userAgent,
          customPageHeaders,
          blockJSRequests,
          cleanupAndExit,
          getHasExited
        });

        // 2. parse ast
        // -> [BLOCK FOR] AST parsing
        let ast;
        try {
          ast = yield astFromCss({
            cssString,
            strict
          });
        } catch (e) {
          cleanupAndExit({ error: e });
          return;
        }

        // 3. Further process the ast [BLOCKING]
        // Strip out non matching media queries.
        // Need to be done before buildSelectorProfile;
        // (very fast but could be done together/in parallel in future)
        (0, _nonMatchingMediaQueryRemover2.default)(ast, width, height, keepLargerMediaQueries);
        debuglog('stripped out non matching media queries');

        // -> [BLOCK FOR] page preparation
        page = yield updatedPagePromise;

        // load the page (slow) [NOT BLOCKING]
        const loadPagePromise = loadPage(page, url, timeout, pageLoadSkipTimeout);
        // turn css to formatted selectorlist [NOT BLOCKING]
        debuglog('turn css to formatted selectorlist START');
        const buildSelectorProfilePromise = (0, _selectorsProfile2.default)(ast, forceInclude).then(function (res) {
          debuglog('turn css to formatted selectorlist DONE');
          return res;
        });

        // -> [BLOCK FOR] page load
        try {
          yield loadPagePromise;
        } catch (e) {
          cleanupAndExit({ error: e });
          return;
        }
        if (!page) {
          // in case we timed out
          debuglog('page load TIMED OUT');
          cleanupAndExit({ error: new Error('Page load timed out') });
          return;
        }

        // take before screenshot (optional) [NOT BLOCKING]
        const beforeScreenshotPromise = takeScreenshots ? grabPageScreenshot({
          type: 'before',
          page,
          screenshots,
          screenshotExtension,
          debuglog
        }) : Promise.resolve();

        // -> [BLOCK FOR] css into formatted selectors list with "sourcemap"
        // latter used to map back to full css rule

        var _ref8 = yield buildSelectorProfilePromise;

        const selectors = _ref8.selectors,
              selectorNodeMap = _ref8.selectorNodeMap;

        // -> [BLOCK FOR] critical css selector pruning (in browser)

        let criticalSelectors;
        try {
          criticalSelectors = yield page.evaluate(_pruneNonCriticalSelectors2.default, {
            selectors,
            renderWaitTime
          }).then(function (criticalSelectors) {
            debuglog('pruneNonCriticalSelectors done');
            return criticalSelectors;
          });
        } catch (err) {
          debuglog('pruneNonCriticalSelector threw an error: ' + err);
          cleanupAndExit({ error: err });
          return;
        }

        // take after screenshot (optional) [NOT BLOCKING]
        let afterScreenshotPromise;
        if (takeScreenshots) {
          // wait for the before screenshot, before start modifying the page
          afterScreenshotPromise = beforeScreenshotPromise.then(function () {
            debuglog('inline critical styles for after screenshot');
            return page.evaluate(_replacePageCss2.default, { css }).then(function () {
              return grabPageScreenshot({
                type: 'after',
                page,
                screenshots,
                screenshotExtension,
                debuglog
              });
            });
          });
        }

        // -> [BLOCK FOR] clean up final ast for critical css
        debuglog('AST cleanup START');
        // NOTE: this function mutates the AST
        (0, _postformatting2.default)({
          ast,
          selectorNodeMap,
          criticalSelectors,
          propertiesToRemove,
          maxEmbeddedBase64Length
        });
        debuglog('AST cleanup DONE');

        // -> [BLOCK FOR] generate final critical css from critical ast
        const css = _cssTree2.default.generate(ast);
        debuglog('generated CSS from AST');

        // -> [BLOCK FOR] take after screenshot (optional)
        yield afterScreenshotPromise;
        debuglog('generateCriticalCss DONE');

        cleanupAndExit({ returnValue: css });
      });

      return function (_x9, _x10) {
        return _ref6.apply(this, arguments);
      };
    })());
  });

  return function pruneNonCriticalCssLauncher(_x8) {
    return _ref5.apply(this, arguments);
  };
})();

var _cssTree = require('css-tree');

var _cssTree2 = _interopRequireDefault(_cssTree);

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _pruneNonCriticalSelectors = require('./browser-sandbox/pruneNonCriticalSelectors');

var _pruneNonCriticalSelectors2 = _interopRequireDefault(_pruneNonCriticalSelectors);

var _replacePageCss = require('./browser-sandbox/replacePageCss');

var _replacePageCss2 = _interopRequireDefault(_replacePageCss);

var _postformatting = require('./postformatting');

var _postformatting2 = _interopRequireDefault(_postformatting);

var _selectorsProfile = require('./selectors-profile');

var _selectorsProfile2 = _interopRequireDefault(_selectorsProfile);

var _nonMatchingMediaQueryRemover = require('./non-matching-media-query-remover');

var _nonMatchingMediaQueryRemover2 = _interopRequireDefault(_nonMatchingMediaQueryRemover);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const debuglog = (0, _debug2.default)('penthouse:core');

function blockinterceptedRequests(interceptedRequest) {
  const isJsRequest = /\.js(\?.*)?$/.test(interceptedRequest.url);
  if (isJsRequest) {
    interceptedRequest.abort();
  } else {
    interceptedRequest.continue();
  }
}

function setupBlockJsRequests(page) {
  page.on('request', blockinterceptedRequests);
  return page.setRequestInterceptionEnabled(true);
}

exports.default = pruneNonCriticalCssLauncher;