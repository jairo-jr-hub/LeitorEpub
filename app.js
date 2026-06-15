const DOM = {
    library: document.getElementById('library-view'),
    reader: document.getElementById('reader-view'),
    bookshelf: document.getElementById('bookshelf'),
    fileInput: document.getElementById('file-input'),
    uploadLabel: document.getElementById('upload-label'),
    topBar: document.getElementById('top-bar'),
    bottomBar: document.getElementById('bottom-bar'),
    settingsModal: document.getElementById('settings-modal'),
    tocModal: document.getElementById('toc-modal'),
    tocList: document.getElementById('toc-list'),
    bookmarksModal: document.getElementById('bookmarks-modal'),
    bookmarksList: document.getElementById('bookmarks-list'),
    progressSlider: document.getElementById('progress-slider'),
    progressLabel: document.getElementById('progress-label'),
    btnQuickSave: document.getElementById('btn-quick-save'),
    btnOpenBookmarks: document.getElementById('btn-open-bookmarks'),
    btnOpenToc: document.getElementById('btn-open-toc')
};

const SafeStorage = {
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
};

let book = null;
let rendition = null;
let currentBookId = null;
let currentLocationCfi = null; 
let isLocationsReady = false;
let totalPages = 1;

let settings = JSON.parse(localStorage.getItem('reader_v10_configs')) || {
    font: "'Literata', serif", size: 100, lineHeight: 1.5, align: "justify", theme: "sepia", brightness: 100, paddingY: 60
};

document.addEventListener('DOMContentLoaded', () => {
    carregarBiblioteca();
    carregarUIConfigs();
});

// ==========================================
// 1. BIBLIOTECA
// ==========================================
async function carregarBiblioteca() {
    DOM.bookshelf.innerHTML = '';
    const library = await localforage.getItem('library_metadata') || [];
    
    if (library.length === 0) {
        DOM.bookshelf.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888; padding-top: 40px;">Nenhum livro importado.</p>';
        return;
    }

    library.forEach(bookMeta => {
        const div = document.createElement('div');
        div.className = 'book-item';
        div.onclick = () => abrirLivro(bookMeta.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '✕';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Excluir "${bookMeta.title}" do aplicativo?`)) {
                await localforage.removeItem(bookMeta.id); 
                SafeStorage.remove('bookmarks_v10_' + bookMeta.id); 
                const nova = library.filter(b => b.id !== bookMeta.id);
                await localforage.setItem('library_metadata', nova); 
                carregarBiblioteca();
            }
        };

        const img = document.createElement('img');
        img.className = 'book-cover';
        img.src = bookMeta.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-family="sans-serif" font-size="12px">Sem Capa</text></svg>';
        
        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = bookMeta.title;

        div.appendChild(deleteBtn); div.appendChild(img); div.appendChild(title);
        DOM.bookshelf.appendChild(div);
    });
}

DOM.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    DOM.uploadLabel.classList.add('loading');
    DOM.uploadLabel.childNodes[0].textContent = " Processando...";
    try {
        const arrayBuffer = await file.arrayBuffer();
        const tempBook = ePub(arrayBuffer);
        await tempBook.ready;
        const metadata = await tempBook.loaded.metadata;
        let coverBase64 = null;
        try {
            const coverUrl = await tempBook.coverUrl();
            if (coverUrl) {
                const response = await fetch(coverUrl);
                const blob = await response.blob();
                coverBase64 = await new Promise(res => {
                    const reader = new FileReader();
                    reader.onloadend = () => res(reader.result);
                    reader.readAsDataURL(blob);
                });
            }
        } catch(e) {}

        const bookId = 'book_' + Date.now();
        await localforage.setItem(bookId, arrayBuffer);
        const library = await localforage.getItem('library_metadata') || [];
        library.push({ id: bookId, title: metadata.title || "Livro Desconhecido", cover: coverBase64 });
        await localforage.setItem('library_metadata', library);
        tempBook.destroy();
        carregarBiblioteca();
    } catch (error) {
        alert("Erro. O arquivo EPUB pode estar corrompido.");
    } finally {
        DOM.uploadLabel.classList.remove('loading');
        DOM.uploadLabel.childNodes[0].textContent = "+ Adicionar Livro";
        DOM.fileInput.value = '';
    }
});

// ==========================================
// 2. MOTOR DE LEITURA (SEM AUTO-SAVE)
// ==========================================
async function abrirLivro(bookId) {
    currentBookId = bookId;
    currentLocationCfi = null;
    isLocationsReady = false;
    DOM.library.classList.add('hidden');
    DOM.reader.classList.remove('hidden');
    esconderMenus();
    DOM.progressLabel.textContent = "Carregando...";

    try {
        const arrayBuffer = await localforage.getItem(bookId);
        book = ePub(arrayBuffer);
        
        rendition = book.renderTo('viewer', {
            width: '100%', height: '100%', spread: 'none', flow: 'paginated', manager: 'default'
        });

        rendition.themes.register("light", { "body": { "background": "#ffffff" }});
        rendition.themes.register("sepia", { "body": { "background": "#FDF7EC" }});
        rendition.themes.register("dark",  { "body": { "background": "#121212" }});

        rendition.hooks.content.register((contents) => {
            const doc = contents.document;
            if (!doc.getElementById('font-literata')) {
                const link = doc.createElement('link'); link.id = 'font-literata'; link.rel = 'stylesheet';
                link.href = 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&display=swap';
                doc.head.appendChild(link);
            }
        });

        aplicarEstilosNoMotor();
        gerarSumario();
        
        // SEMPRE ABRE NO INÍCIO AGORA. Você controla indo na sua lista de marcadores.
        await rendition.display();
        currentLocationCfi = rendition.location ? rendition.location.start.cfi : null;

        book.ready.then(() => book.locations.generate(1600)).then(() => {
            isLocationsReady = true;
            totalPages = book.locations.length || 1;
            atualizarProgresso(currentLocationCfi);
        });

        // Atualiza apenas a barra de progresso visual, sem gravar NADA escondido.
        rendition.on('relocated', (location) => {
            if (location && location.start && location.start.cfi) {
                currentLocationCfi = location.start.cfi;
                atualizarProgresso(currentLocationCfi);
            }
        });

    } catch (e) {
        alert("Falha crítica ao abrir o livro.");
        fecharLivro();
    }
}

// ==========================================
// A LISTA DE MARCADORES (O SEU SALVAMENTO MANUAL)
// ==========================================

function carregarMarcadores() {
    let bookmarks = JSON.parse(SafeStorage.get('bookmarks_v10_' + currentBookId)) || [];
    DOM.bookmarksList.innerHTML = '';
    
    if (bookmarks.length === 0) {
        DOM.bookmarksList.innerHTML = '<li style="justify-content:center; color:#999; font-weight:normal;">Você ainda não salvou nenhuma página.</li>';
        return;
    }

    bookmarks.forEach((bm, index) => {
        const li = document.createElement('li');
        
        const textSpan = document.createElement('span');
        textSpan.textContent = bm.label;
        textSpan.style.flex = "1";
        textSpan.onclick = () => {
            if (rendition && bm.cfi) {
                rendition.display(bm.cfi);
            }
            esconderMenus();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-bookmark';
        delBtn.innerHTML = '✕';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            bookmarks.splice(index, 1);
            SafeStorage.set('bookmarks_v10_' + currentBookId, JSON.stringify(bookmarks));
            carregarMarcadores();
        };

        li.appendChild(textSpan);
        li.appendChild(delBtn);
        DOM.bookmarksList.appendChild(li);
    });
}

// O BOTÃO DE SALVAMENTO RÁPIDO (Mantém só a última página salva)
DOM.btnQuickSave.addEventListener('click', () => {
    const loc = rendition.currentLocation();
    const cfiExato = loc ? loc.start.cfi : currentLocationCfi;
    
    if (!cfiExato) {
        alert("Aguarde a página carregar.");
        return;
    }

    let labelNome = "Última Página Lida";
    if (isLocationsReady && book && book.locations.length > 0) {
        const pct = Math.round(book.locations.percentageFromCfi(cfiExato) * 100);
        labelNome = `Página Salva (${pct}%)`;
    }

    // A Mágica: Ele cria uma array contendo APENAS a sua última página. Nunca acumula.
    let bookmarks = [{ cfi: cfiExato, label: labelNome }];
    
    SafeStorage.set('bookmarks_v10_' + currentBookId, JSON.stringify(bookmarks));
    carregarMarcadores();

    // Feedback Visual de Sucesso
    DOM.btnQuickSave.textContent = "✔ Salvo!";
    DOM.btnQuickSave.style.color = "#34a853";
    
    setTimeout(() => { 
        DOM.btnQuickSave.textContent = "Salvar"; 
        DOM.btnQuickSave.style.color = "#333";
    }, 2000);
});


function fecharLivro() {
    if (book) { book.destroy(); book = null; rendition = null; }
    document.getElementById('viewer').innerHTML = '';
    currentBookId = null; currentLocationCfi = null; isLocationsReady = false;
    DOM.reader.classList.add('hidden');
    DOM.library.classList.remove('hidden');
    document.body.style.background = '#f5f5f7';
    document.getElementById('theme-color-meta').setAttribute('content', '#f5f5f7');
}

// ==========================================
// 3. PÁGINA X DE Y MATEMÁTICO E SUMÁRIO
// ==========================================
function gerarSumario() {
    book.loaded.navigation.then(nav => {
        DOM.tocList.innerHTML = '';
        const renderizarItens = (items, nivel = 0) => {
            items.forEach(chapter => {
                const li = document.createElement('li');
                li.textContent = chapter.label.trim();
                
                if (nivel > 0) {
                    li.style.paddingLeft = `${nivel * 25}px`; 
                    li.style.fontSize = "14px";
                    li.style.opacity = "0.8"; 
                } else {
                    li.style.fontWeight = "bold";
                }

                li.onclick = () => {
                    rendition.display(chapter.href);
                    esconderMenus();
                };
                DOM.tocList.appendChild(li);

                if (chapter.subitems && chapter.subitems.length > 0) {
                    renderizarItens(chapter.subitems, nivel + 1);
                }
            });
        };
        if (nav.toc) { renderizarItens(nav.toc, 0); }
    });
}

function atualizarProgresso(cfi) {
    if (isLocationsReady && book && book.locations.length > 0 && cfi) {
        const percent = book.locations.percentageFromCfi(cfi);
        const currentPage = Math.max(1, Math.round(percent * totalPages));
        DOM.progressSlider.value = Math.round(percent * 100);
        DOM.progressLabel.textContent = `${currentPage} / ${totalPages}`;
    }
}

DOM.progressSlider.addEventListener('change', (e) => {
    if (book && book.locations.length > 0) {
        const percent = e.target.value / 100;
        const targetCfi = book.locations.cfiFromPercentage(percent);
        rendition.display(targetCfi);
    }
});

// ==========================================
// 4. MOTOR DE ESTILIZAÇÃO E MENUS
// ==========================================
async function alterarConfiguracaoLayout(callback) {
    const cfiAtual = currentLocationCfi;
    callback(); 
    carregarUIConfigs();
    salvarConfigs(); 
    
    if (rendition) {
        rendition.resize(); 
        if (cfiAtual) await rendition.display(cfiAtual);
        
        DOM.progressLabel.textContent = "... / ...";
        isLocationsReady = false;
        book.locations.generate(1600).then(() => {
            isLocationsReady = true;
            totalPages = book.locations.length || 1;
            atualizarProgresso(currentLocationCfi);
        });
    }
}

function aplicarEstilosNoMotor() {
    if (!rendition) return;
    rendition.themes.select(settings.theme);

    const coresBg = { 'light': '#ffffff', 'sepia': '#FDF7EC', 'dark': '#121212' };
    const coresTexto = { 'light': '#000000', 'sepia': '#2B1E12', 'dark': '#e0e0e0' };
    const bgCor = coresBg[settings.theme];
    const textCor = coresTexto[settings.theme];

    DOM.reader.style.background = bgCor; document.body.style.background = bgCor;
    document.getElementById('theme-color-meta').setAttribute('content', bgCor);
    
    DOM.settingsModal.style.background = settings.theme === 'dark' ? '#1f1f1f' : '#ffffff';
    DOM.settingsModal.style.color = settings.theme === 'dark' ? '#ffffff' : '#333';
    DOM.tocModal.style.background = settings.theme === 'dark' ? '#1f1f1f' : '#ffffff';
    DOM.tocModal.style.color = textCor;
    DOM.bookmarksModal.style.background = settings.theme === 'dark' ? '#1f1f1f' : '#ffffff';
    DOM.bookmarksModal.style.color = settings.theme === 'dark' ? '#ffffff' : '#333';

    rendition.themes.fontSize(`${settings.size}%`);
    const viewerDiv = document.getElementById('viewer');
    viewerDiv.style.paddingTop = `${settings.paddingY}px`;
    viewerDiv.style.paddingBottom = `${settings.paddingY}px`;

    rendition.themes.default({
        "body": {
            "font-family": settings.font === 'Original' ? "inherit !important" : `${settings.font} !important`,
            "text-align": `${settings.align} !important`,
            "line-height": `${settings.lineHeight} !important`,
            "color": `${textCor} !important`,
            "padding": "0px 20px !important", "margin": "0px !important"
        },
        "p": { "text-align": `${settings.align} !important`, "line-height": `${settings.lineHeight} !important`, "margin-bottom": "1em !important" },
        "h1, h2, h3": { "color": `${textCor} !important`, "font-family": settings.font === 'Original' ? "inherit !important" : `${settings.font} !important` }
    });

    const overlay = document.getElementById('brightness-overlay');
    overlay.style.opacity = 1 - (settings.brightness / 100);
}

function salvarConfigs() {
    SafeStorage.set('reader_v10_configs', JSON.stringify(settings));
    aplicarEstilosNoMotor();
}

function carregarUIConfigs() {
    document.getElementById('label-size').textContent = `${settings.size}%`;
    document.getElementById('label-line').textContent = settings.lineHeight;
    document.getElementById('label-margin-y').textContent = `Resp: ${settings.paddingY}px`;
    document.getElementById('select-align').value = settings.align;
    document.getElementById('brightness-slider').value = settings.brightness;
    
    document.querySelectorAll('.font-btn').forEach(btn => { btn.classList.toggle('selected', btn.dataset.font === settings.font); });
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.remove('active'); btn.textContent = '';
        if(btn.dataset.theme === settings.theme) { btn.classList.add('active'); btn.textContent = '✓'; }
    });
}

// Eventos de Menus
document.getElementById('zone-left').addEventListener('click', () => { if (rendition) rendition.prev(); esconderMenus(); });
document.getElementById('zone-right').addEventListener('click', () => { if (rendition) rendition.next(); esconderMenus(); });
document.getElementById('zone-center').addEventListener('click', () => {
    if (DOM.topBar.classList.contains('hidden')) { DOM.topBar.classList.remove('hidden'); DOM.bottomBar.classList.remove('hidden'); } 
    else { esconderMenus(); }
});

function esconderMenus() {
    DOM.topBar.classList.add('hidden'); DOM.bottomBar.classList.add('hidden');
    DOM.settingsModal.classList.add('hidden'); DOM.tocModal.classList.add('hidden'); DOM.bookmarksModal.classList.add('hidden');
}

// Botões Sup
document.getElementById('btn-back').addEventListener('click', fecharLivro); 
document.getElementById('btn-settings').addEventListener('click', () => { esconderMenus(); DOM.settingsModal.classList.remove('hidden'); });
DOM.btnOpenToc.addEventListener('click', () => { esconderMenus(); DOM.tocModal.classList.remove('hidden'); });

// Botão Abre a Lista de Marcadores
DOM.btnOpenBookmarks.addEventListener('click', () => {
    esconderMenus();
    DOM.bookmarksModal.classList.remove('hidden');
    carregarMarcadores(); 
});

// Abas de Config
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
    });
});

// Controles Visuais
document.querySelectorAll('.font-btn').forEach(btn => { btn.addEventListener('click', (e) => { alterarConfiguracaoLayout(() => { settings.font = e.currentTarget.dataset.font; }); }); });
document.getElementById('btn-size-minus').addEventListener('click', () => { alterarConfiguracaoLayout(() => { if (settings.size > 70) settings.size -= 10; }); });
document.getElementById('btn-size-plus').addEventListener('click', () => { alterarConfiguracaoLayout(() => { if (settings.size < 250) settings.size += 10; }); });
document.getElementById('btn-line-minus').addEventListener('click', () => { alterarConfiguracaoLayout(() => { if (settings.lineHeight > 1.2) settings.lineHeight = (parseFloat(settings.lineHeight) - 0.1).toFixed(1); }); });
document.getElementById('btn-line-plus').addEventListener('click', () => { alterarConfiguracaoLayout(() => { if (settings.lineHeight < 2.5) settings.lineHeight = (parseFloat(settings.lineHeight) + 0.1).toFixed(1); }); });
document.getElementById('select-align').addEventListener('change', (e) => { alterarConfiguracaoLayout(() => { settings.align = e.target.value; }); });
document.getElementById('btn-margin-y-minus').addEventListener('click', () => { alterarConfiguracaoLayout(() => { if (settings.paddingY > 0) settings.paddingY -= 10; }); });
document.getElementById('btn-margin-y-plus').addEventListener('click', () => { alterarConfiguracaoLayout(() => { if (settings.paddingY < 150) settings.paddingY += 10; }); });
document.getElementById('brightness-slider').addEventListener('input', (e) => { settings.brightness = e.target.value; salvarConfigs(); });
document.querySelectorAll('.theme-btn').forEach(btn => { btn.addEventListener('click', (e) => { settings.theme = e.target.dataset.theme; carregarUIConfigs(); salvarConfigs(); }); });
