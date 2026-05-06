const wordInput = document.getElementById("wordInput");
const searchBtn = document.getElementById("searchBtn");
const resultDiv = document.getElementById("result");
const savedListDiv = document.getElementById("savedList");
const clearAllBtn = document.getElementById("clearAllBtn");

let savedWords = JSON.parse(localStorage.getItem("myWords") || "[]");

function showMessage(msg, color) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    toast.style.background = color;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 2000);
}

function showSavedWords() {
    if (savedWords.length == 0) {
        savedListDiv.innerHTML = "<p class='empty-message'>No saved words yet.</p>";
        return;
    }
    let html = "";
    for (let i = 0; i < savedWords.length; i++) {
        html += "<div class='saved-word'>" + savedWords[i] + " <span class='remove-word' data-word='" + savedWords[i] + "'>x</span></div>";
    }
    savedListDiv.innerHTML = html;

    const items = document.querySelectorAll(".saved-word");
    for (let i = 0; i < items.length; i++) {
        items[i].addEventListener("click", function(e) {
            if (e.target.className == "remove-word") {
                const w = e.target.getAttribute("data-word");
                savedWords = savedWords.filter(function(x) { return x != w; });
                localStorage.setItem("myWords", JSON.stringify(savedWords));
                showSavedWords();
                showMessage("Removed " + w, "#e74c3c");
            } else {
                wordInput.value = e.currentTarget.textContent.replace("x", "").trim();
                searchWord();
            }
        });
    }
}

function saveWord(word) {
    if (savedWords.indexOf(word.toLowerCase()) != -1) {
        showMessage(word + " already saved", "#f39c12");
        return;
    }
    savedWords.push(word.toLowerCase());
    localStorage.setItem("myWords", JSON.stringify(savedWords));
    showSavedWords();
    showMessage(word + " saved!", "#27ae60");
}

function saveWordButtonClick(word) {
    saveWord(word);
    searchWord();
}

function searchWord() {
    const word = wordInput.value.trim();
    if (word == "") {
        showMessage("Type a word first", "#e74c3c");
        return;
    }

    resultDiv.style.display = "block";
    resultDiv.innerHTML = "<p style='text-align:center; padding:20px'>Looking up " + word + "...</p>";

    fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + word)
    .then(function(res) {
        if (!res.ok) throw new Error();
        return res.json();
    })
    .then(function(data) {
        const entry = data[0];
        const meaning = entry.meanings[0];
        const definition = meaning.definitions[0].definition;
        const example = meaning.definitions[0].example || "";
        const phonetic = entry.phonetic || "";
        const audioUrl = entry.phonetics && entry.phonetics.find(function(p) { return p.audio; });
        const audio = audioUrl ? audioUrl.audio : "";
        const alreadySaved = savedWords.indexOf(entry.word.toLowerCase()) != -1;

        let synonyms = [];
        for (let i = 0; i < entry.meanings.length; i++) {
            synonyms = synonyms.concat(entry.meanings[i].synonyms || []);
        }
        synonyms = synonyms.slice(0, 8);

        let html = "<div class='word-title'><span>" + entry.word + "</span>";
        html += alreadySaved ? "<button class='save-word-btn saved' disabled>Saved</button>" : "<button class='save-word-btn' onclick=\"saveWordButtonClick('" + entry.word + "')\">Save Word</button>";
        html += "</div>";
        if (phonetic != "") html += "<div class='phonetic'>/" + phonetic + "/ " + (audio ? "<button onclick=\"new Audio('" + audio + "').play()\">Play</button>" : "") + "</div>";
        html += "<div class='meaning-box'><h4>" + meaning.partOfSpeech + "</h4><p>" + definition + "</p>";
        if (example != "") html += "<div class='example'>\"" + example + "\"</div>";
        html += "</div>";
        if (synonyms.length > 0) html += "<div class='synonyms'><strong>Synonyms:</strong> " + synonyms.join(", ") + "</div>";

        resultDiv.innerHTML = html;
    })
    .catch(function() {
        resultDiv.innerHTML = "<div class='error'>Could not find " + word + ". Check spelling and try again.</div>";
    });
}

function clearAllSaved() {
    if (savedWords.length == 0) {
        showMessage("Nothing to clear", "#f39c12");
        return;
    }
    if (confirm("Clear all saved words?")) {
        savedWords = [];
        localStorage.setItem("myWords", JSON.stringify(savedWords));
        showSavedWords();
        showMessage("Cleared!", "#e74c3c");
        resultDiv.style.display = "none";
    }
}

searchBtn.addEventListener("click", searchWord);
clearAllBtn.addEventListener("click", clearAllSaved);
wordInput.addEventListener("keypress", function(e) {
    if (e.key == "Enter") searchWord();
});

showSavedWords();
wordInput.placeholder = "Enter a word...";
