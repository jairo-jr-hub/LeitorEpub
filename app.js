const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const bookshelf = document.getElementById('bookshelf');
const fileInput = document.getElementById('file-input');
const settingsModal = document.getElementById('settings-modal');
const tocModal = document.getElementById('toc-modal');

let currentBook = null;
let rendition = null;
let currentBookId = null;
let saveTimeout = null; // Controle de delay para salvar posição correta

let readerSettings = JSON.parse(localStorage.getItem('reader_settings')) || {
    fontSize: 100,
    fontFamily: "'Literata', serif", 
    theme: 'sepia', 
    brightness: 100
};

document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    initUIEvents();
});

function fecharMenus() {
    readerView.classList.add('ui-hidden');
    settingsModal.classList.add('hidden');
    tocModal.classList.add('hidden');
}

// --- SALVAMENTO ROBUSTO BLINDADO PARA iOS ---
// Usamos localforage (IndexedDB) no lugar do localStorage para garantir persistência real em PWAs
async function salvarPosicao(cfi) {
    if (!currentBookId || !cfi) return;
    try {
        await localforage.setItem(`pos_${currentBookId}`, cfi);
    } catch (e) {
        console.error("Erro ao salvar progresso:", e);
    }
}

// --- BIBLIOTECA ---
async function loadLibrary() {
    bookshelf.innerHTML = '';
    const library = await localforage.getItem('library_metadata') || [];
    
    if (library.length === 0) {
        bookshelf.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666; margin-top: 20px;">Nenhum livro salvo.</p>';
        return;
    }

    library.forEach(bookMeta => {
        const div = document.createElement('div');
        div.className = 'book-item';
        div.onclick = () => openBook(bookMeta.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '✕'; 
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Excluir permanentemente o livro "${bookMeta.title}" do leitor?`)) {
                await localforage.removeItem(bookMeta.id);
                await localforage.removeItem(`pos_${bookMeta.id}`); // Limpa progresso salvo
                const novaBiblioteca = library.filter(b => b.id !== bookMeta.id);
                await localforage.setItem('library_metadata', novaBiblioteca);
                loadLibrary();
            }
        };

        const img = document.createElement('img');
        img.className = 'book-cover';
        img.src = bookMeta.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23ddd"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">Sem Capa</text></svg>';
        
        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = bookMeta.title;

        div.appendChild(deleteBtn);
        div.appendChild(img);
        div.appendChild(title);
        bookshelf.appendChild(div);
    });
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.querySelector('.upload-btn').childNodes[0].textContent = "Processando...";
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bookData = ePub(arrayBuffer);
        await bookData.ready;
        const metadata = await bookData.loaded.metadata;
        let coverBase64 = null;
        try {
            const coverUrl = await bookData.coverUrl();
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
        library.push({ id: bookId, title: metadata.title, cover: coverBase64 });
        await localforage.setItem('library_metadata', library);
        await loadLibrary();
    } catch (error) { alert("Erro ao processar o arquivo."); } 
    finally {
        document.querySelector('.upload-btn').childNodes[0].textContent = "Adicionar EPUB";
        fileInput.value = '';
    }
});

// --- RENDERIZAÇÃO DO LIVRO ---
async function openBook(bookId) {
    currentBookId = bookId;
    libraryView.style.display = 'none';
    readerView.style.display = 'block';
    fecharMenus(); 

    try {
        const arrayBuffer = await localforage.getItem(bookId);
        currentBook = ePub(arrayBuffer);
        
        rendition = currentBook.renderTo('viewer', {
            width: '100%',
            height: '100%',
            spread: 'none',
            manager: 'continuous',
            flow: 'paginated'
        });

        rendition.themes.register("light", { "body": { "background": "#ffffff !important" }});
        rendition.themes.register("sepia", { "body": { "background": "#fefbec !important" }});
        rendition.themes.register("dark", { "body": { "background": "#121212 !important" }});
        
        rendition.themes.select(readerSettings.theme);
        rendition.themes.fontSize(readerSettings.fontSize + "%");
        
        rendition.hooks.content.register((contents) => {
            aplicarEstilosNoConteudo(contents);
        });

        aplicarConfiguracoesDinamicas();

        // Recupera o salvamento usando o motor blindado
        const savedCfi = await localforage.getItem(`pos_${bookId}`);
        
        if (savedCfi) {
            try { 
                await rendition.display(savedCfi); 
            } catch(e) { 
                await rendition.display(); 
            }
        } else {
            await rendition.display();
        }

        currentBook.loaded.navigation.then(nav => {
            const tocList = document.getElementById('toc-list');
            tocList.innerHTML = '';
            
            const generateToc = (items, level = 0) => {
                items.forEach(chapter => {
                    const li = document.createElement('li');
                    li.className = 'toc-item';
                    li.style.paddingLeft = `${level * 20}px`;
                    li.textContent = chapter.label.trim() || 'Capítulo';
                    
                    li.onclick = () => {
                        rendition.display(chapter.href);
                        fecharMenus(); 
                    };
                    tocList.appendChild(li);
                    
                    if (chapter.subitems && chapter.subitems.length > 0) {
                        generateToc(chapter.subitems, level + 1);
                    }
                });
            };
            if (nav.toc) generateToc(nav.toc);
        });

        currentBook.ready.then(() => {
            return currentBook.locations.generate(1600);
        }).then(() => {
            if(rendition.location) {
                const percentage = currentBook.locations.percentageFromCfi(rendition.location.start.cfi);
                document.getElementById('progress-slider').value = Math.round(percentage * 100);
                document.getElementById('page-info').textContent = `${Math.round(percentage * 100)}%`;
            }
        });

        // Evento 'relocated' com DEBOUNCE (Evita salvar a página errada enquanto folheia)
        rendition.on('relocated', (location) => {
            document.getElementById('btn-bookmark').classList.remove('saved'); 
            
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (location && location.start && location.start.cfi) {
                    await salvarPosicao(location.start.cfi); 
                }
                if(currentBook.locations.length > 0) {
                    const percentage = currentBook.locations.percentageFromCfi(location.start.cfi);
                    document.getElementById('progress-slider').value = Math.round(percentage * 100);
                    document.getElementById('page-info').textContent = `${Math.round(percentage * 100)}%`;
                }
            }, 600); // Aguarda 600ms antes de confirmar que a página foi fixada e salvar
        });

    } catch (e) { fecharLivro(); }
}

function fecharLivro() {
    currentBookId = null;
    if (currentBook) { currentBook.destroy(); currentBook = null; rendition = null; }
    document.getElementById('viewer').innerHTML = '';
    readerView.style.display = 'none';
    libraryView.style.display = 'block';
    
    document.documentElement.style.backgroundColor = '#f5f5f7';
    document.body.style.backgroundColor = '#f5f5f7';
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', '#f5f5f7');
}

// --- INTERAÇÕES DA UI ---
function initUIEvents() {
    document.getElementById('zone-left').addEventListener('click', () => { if (rendition) rendition.prev(); fecharMenus(); });
    document.getElementById('zone-right').addEventListener('click', () => { if (rendition) rendition.next(); fecharMenus(); });
    
    document.getElementById('zone-center').addEventListener('click', () => {
        const isHidden = readerView.classList.contains('ui-hidden');
        if (isHidden) { readerView.classList.remove('ui-hidden'); } 
        else { fecharMenus(); }
    });

    document.getElementById('btn-back').addEventListener('click', fecharLivro);
    
    document.getElementById('btn-bookmark').addEventListener('click', async () => {
        if (rendition && rendition.location && rendition.location.start) {
            await salvarPosicao(rendition.location.start.cfi);
            document.getElementById('btn-bookmark').classList.add('saved'); 
        }
    });

    document.getElementById('btn-aa').addEventListener('click', () => {
        tocModal.classList.add('hidden');
        settingsModal.classList.toggle('hidden');
    });

    document.getElementById('btn-toc').addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        tocModal.classList.toggle('hidden');
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
        });
    });

    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            readerSettings.fontFamily = e.currentTarget.dataset.font;
            aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig();
        });
    });

    document.getElementById('btn-font-plus').addEventListener('click', () => { readerSettings.fontSize += 10; aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig(); });
    document.getElementById('btn-font-minus').addEventListener('click', () => { if(readerSettings.fontSize > 50) readerSettings.fontSize -= 10; aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig(); });

    document.querySelectorAll('.theme-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            readerSettings.theme = e.target.dataset.theme;
            aplicarConfiguracoesDinamicas();
            salvarConfig();
        });
    });

    document.getElementById('brightness-slider').addEventListener('input', (e) => { readerSettings.brightness = e.target.value; aplicarBrilho(); salvarConfig(); });

    atualizarUI(); 
}

function salvarConfig() { localStorage.setItem('reader_settings', JSON.stringify(readerSettings)); }

function aplicarConfiguracoesDinamicas() {
    if (!rendition) return;
    
    rendition.themes.select(readerSettings.theme);
    
    const bgColors = { 'light': '#ffffff', 'sepia': '#fefbec', 'dark': '#121212' };
    const textColors = { 'light': '#000000', 'sepia': '#3a2d24', 'dark': '#cccccc' }; 
    const currentBgColor = bgColors[readerSettings.theme];
    
    readerView.style.background = currentBgColor;
    settingsModal.style.background = (readerSettings.theme === 'dark') ? '#1f1f1f' : '#ffffff';
    
    tocModal.style.background = currentBgColor;
    tocModal.style.color = textColors[readerSettings.theme];

    document.documentElement.style.backgroundColor = currentBgColor;
    document.body.style.backgroundColor = currentBgColor;

    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', currentBgColor);
    }

    rendition.themes.fontSize(readerSettings.fontSize + "%");
    
    if (rendition.getContents) {
        rendition.getContents().forEach(content => aplicarEstilosNoConteudo(content));
    }
    
    aplicarBrilho();
}

// --- ESTRATÉGIA NUCLEAR DE ESTILO ---
function aplicarEstilosNoConteudo(content) {
    const doc = content.document;

    let style = doc.getElementById('epub-dynamic-styles');
    if (!style) {
        style = doc.createElement('style');
        style.id = 'epub-dynamic-styles';
        doc.head.appendChild(style);
    }

    const textColors = { 'light': '#000000', 'sepia': '#3a2d24', 'dark': '#cccccc' };
    const highlightColors = { 'light': '#000000', 'sepia': '#110a05', 'dark': '#ffffff' }; 
    
    const currentText = textColors[readerSettings.theme];
    const currentHighlight = highlightColors[readerSettings.theme];
    
    const fontToApply = readerSettings.fontFamily !== 'Original' ? `font-family: ${readerSettings.fontFamily} !important;` : '';

    // Importar via @import previne o bloqueio do Safari
    style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&display=swap');

        body {
            padding: calc(40px + env(safe-area-inset-top)) 20px calc(80px + env(safe-area-inset-bottom)) 20px !important; 
            margin: 0 !important; 
            background-color: transparent !important;
            text-rendering: optimizeLegibility !important;
            -webkit-font-smoothing: antialiased !important;
        }
        
        /* Força a cor e a fonte em todos os elementos de texto base */
        p, div, span, a, li, td {
            color: ${currentText} !important;
            ${fontToApply}
            line-height: 1.6 !important;
            font-weight: 400 !important;
        }

        /* Protege cabeçalhos e negritos com a cor de destaque (mais escura) */
        h1, h2, h3, h4, h5, h6, strong, b, em, i {
            color: ${currentHighlight} !important;
            font-weight: 700 !important;
            ${fontToApply}
        }

        /* Captura as tags iniciais geralmente usadas pelas editoras para destacar o começo de capítulo */
        p:first-of-type > span,
        p:first-of-type > strong,
        p:first-of-type > b,
        p > span:first-child,
        p > strong:first-child,
        p > b:first-child {
            color: ${currentHighlight} !important;
            font-weight: 700 !important;
        }
    `;
}

function aplicarBrilho() {
    const overlay = document.getElementById('brightness-overlay');
    const darkness = 1 - (readerSettings.brightness / 100);
    overlay.style.opacity = darkness;
}

function atualizarUI() {
    document.getElementById('font-size-display').textContent = readerSettings.fontSize + '%';
    document.getElementById('brightness-slider').value = readerSettings.brightness;
    aplicarBrilho();
    
    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.font === readerSettings.fontFamily);
    });
    
    document.querySelectorAll('.theme-color-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.theme === readerSettings.theme);
    });
}
