"use strict";

var version = "1.0"; // version of the debugger to use
var attachedTabs = {}; // keeps track of which tabs we've attached the debugger to
var getResponseAlarmName = "getResponseAlarm"; // name of alarm
var responseBodiesToFetch = []; // keeps track of responses to fetch bodies for when alarm is triggered

// concatenated string of the query and search modifiers/filters used to uniquely
// identify the search we are currently keeping track of results for
var currentSearchId = "";
var currentSearchQuery = "";
var currentSearchModifiers = Object.create(null);
// only append to our list of results for this search if the new batch of data has
// this offset. This is to avoid accidentally re-pushing the same batch of data
var nextTargetOffset = 0;
// array of search results so far for the current search
var searchResults = [];


// Setup
// -----

chrome.runtime.onInstalled.addListener(function() {
	chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
		chrome.declarativeContent.onPageChanged.addRules([{
			conditions: [
				new chrome.declarativeContent.PageStateMatcher({
					pageUrl: {
						hostContains: "embed.iseek"
					}
				})
			],
			actions: [new chrome.declarativeContent.ShowPageAction()]
		}]);
	});
});

// Tabs
// ----

chrome.tabs.onHighlighted.addListener(function(info) {
	var numTIds = info.tabIds.length;
	var tId;
	for (var i = 0; i < numTIds; ++i) {
		tId = info.tabIds[i];
		chrome.tabs.get(tId, function(tab) {
			manageDebuggerForTab(tab.url, tId, tab.active);
		});
	}
})
chrome.tabs.onActivated.addListener(function(info) {
	var tId = info.tabId;
	chrome.tabs.get(tId, function(tab) {
		manageDebuggerForTab(tab.url, tId, tab.active);
	});
});
chrome.tabs.onRemoved.addListener(doDetach);
chrome.tabs.onUpdated.addListener(function(tId, changeInfo, tab) {
	manageDebuggerForTab(tab.url, tId, tab.active);
});

function manageDebuggerForTab(url, tId, isActive) {
	if (url) {
		if (isRightPage(url) && isActive) {
			doAttach(tId);
		} else {
			doDetach(tId);
		}
	}
}

// Debugger
// --------

chrome.debugger.onEvent.addListener(onNetworkEvent);
chrome.debugger.onDetach.addListener(function(debuggee) {
	doDetach(debuggee.tabId);
});

// Alarms
// ------

chrome.alarms.onAlarm.addListener(function(alarm) {
	if (alarm.name == getResponseAlarmName && responseBodiesToFetch.length > 0) {
		var numToFetch = responseBodiesToFetch.length;
		var fetchInfo;
		for (var i = 0; i < numToFetch; ++i) {
			fetchInfo = responseBodiesToFetch[i];
			getResponseBody(fetchInfo.debugger, fetchInfo.requestId);
		}
	}
});

// Methods
// -------

function doAttach(tId) {
	if (attachedTabs[tId] !== true) {
		var deb1 = debuggee(tId);
		chrome.debugger.attach(deb1, version, onAttach.bind(null, deb1));
		attachedTabs[tId] = true;
	}
}

function doDetach(tId) {
	if (attachedTabs[tId] == true) {
		resetTrackingIfNewSearch();
		var deb1 = debuggee(tId);
		chrome.debugger.detach(deb1, onDetach.bind(null, deb1));
		delete attachedTabs[tId];
	}
}

function getResponseBody(srcDebugger, reqId) {
	chrome.debugger.sendCommand(srcDebugger, "Network.getResponseBody", {
		requestId: reqId
	}, function(result) {
		if (chrome.runtime.lastError) {
			console.log(chrome.runtime.lastError.message);
			return;
		}
		if (result.body) {
			processResponseBody(JSON.parse(result.body));
		}
	});
}


// Handlers
// --------

// fired after the debugger has been attached to the debuggee
function onAttach(debuggee) {
	if (chrome.runtime.lastError) {
		console.log(chrome.runtime.lastError.message);
		return;
	}
	chrome.debugger.sendCommand(debuggee, "Network.enable", {}, logIfError);
}
// fired after the debugger has been DEtached from the debuggee
function onDetach(debuggee) {
	if (chrome.runtime.lastError) {
		console.log(chrome.runtime.lastError.message);
		return;
	}
	chrome.debugger.sendCommand(debuggee, "Network.disable", {}, logIfError);
}
// åfter the debugger is attached and remote network debugging is enabled,
// handle network events here
function onNetworkEvent(srcDebugger, eventName, eventParams) {
	if (eventName == "Network.responseReceived" && eventParams.type == "XHR") {
		responseBodiesToFetch.push({
			requestId: eventParams.requestId,
			debugger: srcDebugger
		});
		chrome.alarms.create(getResponseAlarmName, {
			when: Date.now() + 2 * 1000
		});
	}
}

// Response body processing
// ------------------------

function processResponseBody(body) {
	if (!body.params) {
		return;
	}
	var searchQuery = body.params.q; // string search query
	// array of strings where each string is a object entry concatenated on
	// a colon separating the object key from the object value
	var searchModifierArray = body.params.ivArr;

	var offset = !isNaN(body.params.off) ? parseInt(body.params.off) : -1;
	var max = !isNaN(body.params.num) ? parseInt(body.params.num) : -1;
	var results = body.data; // array of objects representing search results

	resetTrackingIfNewSearch(searchQuery, searchModifierArray);
	tryAddToSearchResults(offset, max, results);
}

function resetTrackingIfNewSearch(query, modifiers) {
	var thisSearchId = buildSearchId(query, modifiers);
	if (!thisSearchId || thisSearchId !== currentSearchId) {
		currentSearchId = thisSearchId;
		nextTargetOffset = 0;
		searchResults = [];
		currentSearchQuery = query;
		// parse modifier strings into a key/value object
		currentSearchModifiers = Object.create(null);
		if (modifiers) {
			var numModifiers = modifiers.length;
			var modifier, separatorIndex, filterCode, filterValue;
			for (var i = 0; i < numModifiers; ++i) {
				modifier = modifiers[i];
				separatorIndex = modifier.indexOf(":");
				filterCode = modifier.slice(0, separatorIndex);
				filterValue = modifier.slice(separatorIndex + 1).replace(/"/g, "");
				if (currentSearchModifiers[filterCode]) {
					currentSearchModifiers[filterCode] = currentSearchModifiers[filterCode] + ", " + filterValue;
				} else {
					currentSearchModifiers[filterCode] = filterValue;
				}
			}
		}
	}
}

function tryAddToSearchResults(offset, max, results) {
	if (offset !== nextTargetOffset) {
		return;
	}
	var numResults = results.length;
	for (var i = 0; i < numResults; ++i) {
		searchResults.push(results[i]);
	}
	nextTargetOffset = offset + max;
}


// Helpers
// -------

function buildSearchId(query, modifiers) {
	var modifierString = ""
	if (modifiers) {
		modifiers.sort(); //in-place search
		modifierString = modifiers.join(";");
	}
	if (query && modifierString) {
		return query + ";" + modifierString;
	} else if (query) {
		return query;
	} else if (modifierString) {
		return modifierString;
	} else {
		return "";
	}
}

function logIfError() {
	if (chrome.runtime.lastError) {
		console.log(chrome.runtime.lastError.message);
		return;
	}
}

function debuggee(tabId) {
	return {
		tabId: tabId
	};
}

function isRightPage(url) {
	return url.toLowerCase().includes("iseek");
}