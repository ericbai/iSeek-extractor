"use strict";

function doBuildAndExport(data, searchQuery, searchModifiers) {

    var fileRoot = searchQuery.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    //add excel header row before implementing for loop on each hit
    var dataRows = [];
    var header = ["Unique Lecture", "Graduation Year", "Program Level", "Course", "Document Type", "Page", "Lecture Title", "Date", "Keyword(s)", "Lecturer", "Score"];
    dataRows.push(header);

    // search results
    // data[#] == the result row
    for (var i = 0; i < data.length; i++) {
        var courseid = data[i].doclist.docs[0].courseid_s; // use docs[0], first page hit, as template to extract data
        var coursename = data[i].doclist.docs[0].coursename_s;
        var gradyear = data[i].doclist.docs[0].curriculumyear_ss[0];
        var semester = data[i].doclist.docs[0].group_ss[0];
        var date = data[i].doclist.docs[0].eventdate_min_dt;
        var filetype = data[i].doclist.docs[0].filetype_s;
        var lecturetype = ""; // data[i].doclist.docs[0].module_category_ss[0];
        var school = data[i].doclist.docs[0].source_s;
        var lecturetitle = data[i].doclist.docs[0].title_t;

        var matchparagraph = document.createElement("div");
        matchparagraph.innerHTML = data[i].doclist.docs[0].hl_content_txt[0];
        var matchterms = matchparagraph.getElementsByTagName('strong');
        matchterms = matchterms[0] ? matchterms[0].innerHTML : "";
        var matchtext = matchterms;

        for (var j = 0; j < data[i].doclist.docs.length; j++) {
            var score = data[i].doclist.docs[j].score;
            var instructor = data[i].doclist.docs[j]["instructor_ss"];
            // if instructor field not specified then we pull the last word of the title
            if (!instructor) {
                var titleWords = lecturetitle.split(" ");
                instructor = titleWords[titleWords.length - 1];
            }
            var page = data[i].doclist.docs[j].page_number_i + " ";
            var newRow = [i + 1, gradyear, semester, coursename, filetype, page, lecturetitle,
                formatDate(new Date(date)), matchtext, instructor, score
            ];
            dataRows.push(newRow.map(escapeCsvCell));
        }
    }
    downloadFile(fileRoot + ".csv", encodeAsCsv(dataRows));

    // build additional search info file
    var searchInfoArray = [
        ["Date of search", escapeCsvCell(formatDate(new Date()))],
        ["Search query", escapeCsvCell(searchQuery)]
    ];
    for (var prop in searchModifiers) {
        // we initialized an empty object with zero starting properties
        // so hasOwnProperty function might not exist
        if (!searchModifiers.hasOwnProperty || searchModifiers.hasOwnProperty(prop)) {
            searchInfoArray.push([translateSearchFilter(prop), escapeCsvCell(searchModifiers[prop])]);
        }
    }
    downloadFile(fileRoot + "-info.csv", encodeAsCsv(searchInfoArray));
}

// from https://stackoverflow.com/questions/3552461/how-to-format-a-javascript-date
function formatDate(date) {
    var monthNames = [
        "January", "February", "March",
        "April", "May", "June", "July",
        "August", "September", "October",
        "November", "December"
    ];

    var day = date.getDate();
    var monthIndex = date.getMonth();
    var year = date.getFullYear();

    return monthNames[monthIndex] + ' ' + day + ', ' + year;
}

function escapeCsvCell(contents) {
    return "\"" + contents + "\"";
}

function encodeAsCsv(dataArray) {
    var csvContent = "data:text/csv;charset=utf-8,";
    var dataString;
    dataArray.forEach(function(infoArray, index) {
        dataString = infoArray.join(",");
        csvContent += index < dataArray.length ? dataString + "\n" : dataString;
    });
    return csvContent;
}

function downloadFile(fileName, contents) {
    var encodedUri = encodeURI(contents);
    var link = document.createElement("a");
    link.innerHTML = "download file";
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", fileName);

    link.click(); // This will download the data file
}

function translateSearchFilter(filterCode) {
    switch (filterCode) {
        case "module_category_ss":
            return "Category";
        case "cluster":
            return "Topic";
        case "eventdate_dts":
            return "Date";
        case "sortableinstructor_ss":
            return "Instructor/Author";
        case "eventtype_ss":
            return "Instructional Method";
        case "filetype_s":
            return "File Type";
        case "coursename_s":
            return "Course Name";
        case "group_ss":
            return "Program Level";
        case "curriculumyear_ss":
            return "Graduation Year";
        case "source_s":
            return "Source";
        default:
            return "";
    }
}

function insertTableRow(tableEl, filterCode, filterValue) {
    var rowEl = document.createElement("tr"),
        nameCellEl = document.createElement("td"),
        valCellEl = document.createElement("td");
    nameCellEl.innerHTML = translateSearchFilter(filterCode);
    valCellEl.innerHTML = filterValue;
    rowEl.appendChild(nameCellEl);
    rowEl.appendChild(valCellEl);
    tableEl.appendChild(rowEl);
}

document.addEventListener("DOMContentLoaded", function(event) {
    chrome.runtime.getBackgroundPage(function(trackerWindow) {
        var searchResults = trackerWindow.searchResults;
        var currentSearchQuery = trackerWindow.currentSearchQuery;
        var currentSearchModifiers = trackerWindow.currentSearchModifiers;

        if (searchResults.length === 0 || !currentSearchQuery) {
            document.body.className = "empty";
            return;
        }

        var queryEl = document.getElementById("query");
        var numEl = document.getElementById("num-results");
        var tableEl = document.getElementById("modifiers");
        var exportBtnEl = document.getElementById("start-export-btn");

        queryEl.innerHTML = currentSearchQuery;
        numEl.innerHTML = searchResults.length;
        for (var prop in currentSearchModifiers) {
            // we initialized an empty object with zero starting properties
            // so hasOwnProperty function might not exist
            if (!currentSearchModifiers.hasOwnProperty || currentSearchModifiers.hasOwnProperty(prop)) {
                insertTableRow(tableEl, prop, currentSearchModifiers[prop]);
            }
        }

        exportBtnEl.onclick = doBuildAndExport.bind(null, searchResults, currentSearchQuery, currentSearchModifiers);
    });
});