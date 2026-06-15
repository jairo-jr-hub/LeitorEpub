// Estado do Leitor
let book = null;
let rendition = null;
let currentTheme = 'sepia';
let currentFont = 'Literata';
let currentSize = 100;

const DOM = {
    startup: document.getElementById('startup-screen'),
    viewer: document.getElementById('viewer'),
    upload: document.getElementById('book-upload'),
    topBar: document.getElementById('top-bar'),
    bottomBar: document.getElementById('bottom-bar'),
    settingsModal: document.getElementById('settings-modal'),
    btnAa: document.getElementById('btn-aa'),
    btnBack: document.getElementById('btn-back'),
    prevPage: document.getElementById('prev-page'),
    nextPage: document.getElementById('next-page'),
    pageInfo: document.getElementById('page-info'),
    tabText: document.getElementById('tab-text'),
    tabLight: document.getElementById('tab-light'),
    panelText: document.getElementById('panel-text'),
    panelLight: document.getElementById('panel-light'),
    fontBtns: document.querySelectorAll('.font-btn'),
    themeBtns: document.querySelectorAll('.theme-btn'),
    btnSizeUp: document.getElementById('btn-size-up'),
    btnSizeDown: document.getElementById('btn-size-down'),
    currentSizeTxt: document.getElementById('current-size')
};

// Carregar arquivo EPUB
DOM.upload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        initBook(e.target.result);
    };
    reader.readAsArrayBuffer(file);
});

function initBook(bookData) {
    DOM.startup.classList.add('hidden');
    DOM.viewer.classList.remove('hidden');

    book = ePub(bookData);
    
    // Configurações cruciais de renderização mobile
    rendition = book.renderTo("viewer", {
        width: "100%",
        height: "100%",
        spread: "none", 
        manager: "continuous",
        flow: "paginated",
        snap: true
    });

    // Garante que o iframe do livro conheça e use a fonte Literata
    rendition.hooks.content.register(function(contents) {
        contents.addStylesheet("https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&display=swap");
    });

    // Mapear os temas no motor do epub.js
    rendition.themes.register("light", { "body": { "background": "#FFFFFF", "color": "#000000" }});
    rendition.themes.register("sepia", { "body": { "background": "#FDF7EC", "color": "#3B2A19" }});
    rendition.themes.register("dark",  { "body": { "background": "#000000", "color": "#A3A3A3" }});

    applySettings();
    
    rendition.display().then(() => {
        updatePageInfo();
        generateLocations(); 
    });

    // Eventos de Toque e Swipe
    rendition.on('click', handleViewerClick);
    rendition.on('touchstart', handleTouchStart);
    rendition.on('touchend', handleTouchEnd);
    rendition.on('relocated', updatePageInfo);
}

// Suporte a Swipe (Arrastar para o lado)
let touchStartX = 0;
let touchEndX = 0;

function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
}

function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) > 40) {
        if (diff > 0) rendition.prev();
        else rendition.next();
    }
}

// Toque nas bordas para passar página ou centro para abrir Menu
function handleViewerClick(e) {
    const screenWidth = window.innerWidth;
    const clickX = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    if (!clickX) return;

    if (clickX > screenWidth * 0.3 && clickX < screenWidth * 0.7) {
        toggleUI();
    } else if (clickX <= screenWidth * 0.3) {
        rendition.prev();
    } else {
        rendition.next();
    }
}

function toggleUI() {
    const isVisible = DOM.topBar.classList.contains('visible');
    if (isVisible) {
        DOM.topBar.classList.remove('visible');
        DOM.bottomBar.classList.remove('visible');
        DOM.settingsModal.classList.remove('visible');
    } else {
        DOM.topBar.classList.add('visible');
        DOM.bottomBar.classList.add('visible');
    }
}

DOM.btnBack.addEventListener('click', () => location.reload()); // Reseta o app para ler outro
DOM.btnAa.addEventListener('click', () => DOM.settingsModal.classList.toggle('visible'));
DOM.prevPage.addEventListener('click', () => rendition && rendition.prev());
DOM.nextPage.addEventListener('click', () => rendition && rendition.next());

// Alternar Abas (Texto / Iluminação)
DOM.tabText.addEventListener('click', () => {
    DOM.tabText.classList.add('active');
    DOM.tabLight.classList.remove('active');
    DOM.panelText.classList.remove('hidden');
    DOM.panelLight.classList.add('hidden');
});

DOM.tabLight.addEventListener('click', () => {
    DOM.tabLight.classList.add('active');
    DOM.tabText.classList.remove('active');
    DOM.panelLight.classList.remove('hidden');
    DOM.panelText.classList.add('hidden');
});

// Alterar Fontes
DOM.fontBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        DOM.fontBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFont = btn.dataset.font;
        applySettings();
    });
});

// Alterar Tamanho da Letra
DOM.btnSizeUp.addEventListener('click', () => {
    if (currentSize < 200) currentSize += 10;
    DOM.currentSizeTxt.textContent = `${currentSize}%`;
    applySettings();
});

DOM.btnSizeDown.addEventListener('click', () => {
    if (currentSize > 60) currentSize -= 10;
    DOM.currentSizeTxt.textContent = `${currentSize}%`;
    applySettings();
});

// Alterar Tema de Cor
DOM.themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        DOM.themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTheme = btn.dataset.theme;
        document.body.className = `theme-${currentTheme}`;
        applySettings();
    });
});

// Força Justificação e Estilos idênticos ao Play Livros
function applySettings() {
    if (!rendition) return;
    rendition.themes.select(currentTheme);
    rendition.themes.default({
        "body": {
            "font-family": `"${currentFont}", serif !important`,
            "text-align": "justify !important",
            "line-height": "1.6 !important"
        },
        "p": {
            "text-align": "justify !important",
            "line-height": "1.6 !important"
        }
    });
    rendition.themes.fontSize(`${currentSize}%`);
}

// Calcula porcentagem lida
function generateLocations() {
    book.ready.then(() => book.locations.generate(1600)).then(() => updatePageInfo());
}

function updatePageInfo() {
    if (!book || !rendition) return;
    const location = rendition.currentLocation();
    if (location && location.start) {
        if (book.locations.length > 0) {
            const percentage = Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100);
            DOM.pageInfo.textContent = `${percentage}%`;
        } else {
            DOM.pageInfo.textContent = 'Calculando...';
        }
    }
}
