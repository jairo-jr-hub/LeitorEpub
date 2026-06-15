const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const bookshelf = document.getElementById('bookshelf');
const fileInput = document.getElementById('file-input');

let currentBook = null;
let rendition = null;
let currentBookId = null;

// Configurações persistentes
let readerSettings = JSON.parse(localStorage.getItem('reader_settings')) || {
    fontSize: 100,
    theme: 'light',
    margin: 20
};

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', loadLibrary);

async function loadLibrary() {
    bookshelf.innerHTML = '';
    const library = await localforage.getItem('library_metadata') || [];
    
    if (library.length === 0) {
        bookshelf.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666;">Nenhum livro salvo. Adicione um EPUB.</p>';
        return;
    }

    library.forEach(bookMeta => {
        const div = document.createElement('div');
        div.className = 'book-item';
        div.onclick = () => openBook(bookMeta.id);

        const img = document.createElement('img');
        img.className = 'book-cover';
        img.src = bookMeta.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23ddd"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif">Sem Capa</text></svg>';
        
        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = bookMeta.title || 'Livro Desconhecido';

        div.appendChild(img);
        div.appendChild(title);
        bookshelf.appendChild(div);
    });
}

// --- Importação de Arquivo ---
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Alerta básico visual de carregamento
    const btnText = document.querySelector('.upload-btn').childNodes[0];
    btnText.textContent = "Processando...";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const bookData = ePub(arrayBuffer);
        await bookData.ready;
        
        const metadata = await bookData.loaded.metadata;
        let coverBase64 = null;
        
        // Extrair a capa (converte o blob interno para base64 para persistir com segurança)
        const coverUrl = await bookData.coverUrl();
        if (coverUrl) {
            const response = await fetch(coverUrl);
            const blob = await response.blob();
            coverBase64 = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }

        const bookId = 'book_' + Date.now();

        // Salvar binário do livro no IndexedDB
        await localforage.setItem(bookId, arrayBuffer);

        // Salvar metadados no índice da biblioteca
        const library = await localforage.getItem('library_metadata') || [];
        library.push({
            id: bookId,
            title: metadata.title,
            cover: coverBase64,
            cfi: null // Salvará o progresso de leitura aqui
        });
        await localforage.setItem('library_metadata', library);

        await loadLibrary();
    } catch (error) {
        alert("Erro ao processar o EPUB. O arquivo pode estar corrompido.");
        console.error(error);
    } finally {
        btnText.textContent = "Adicionar EPUB";
        fileInput.value = ''; // Reseta o input
    }
});

// --- Abrir e Renderizar o Livro ---
async function openBook(bookId) {
    currentBookId = bookId;
    libraryView.style.display = 'none';
    readerView.style.display = 'flex';

    const arrayBuffer = await localforage.getItem(bookId);
    currentBook = ePub(arrayBuffer);
    
    rendition = currentBook.renderTo('viewer', {
        width: '100%',
        height: '100%',
        spread: 'none',
        manager: 'continuous',
        flow: 'paginated'
    });

    // Registra temas
    rendition.themes.register("light", { "body": { "background": "#ffffff", "color": "#000000" }});
    rendition.themes.register("dark", { "body": { "background": "#121212", "color": "#e0e0e0" }});
    
    aplicarConfiguracoesVisuais();

    // Carregar progresso salvo
    const library = await localforage.getItem('library_metadata');
    const bookMeta = library.find(b => b.id === bookId);
    
    if (bookMeta && bookMeta.cfi) {
        rendition.display(bookMeta.cfi);
    } else {
        rendition.display();
    }

    // Salvar progresso de leitura sempre que virar a página
    rendition.on('relocated', async (location) => {
        bookMeta.cfi = location.start.cfi;
        await localforage.setItem('library_metadata', library);
    });
}

// --- Controles de Leitura ---
document.getElementById('btn-back').addEventListener('click', () => {
    if (currentBook) {
        currentBook.destroy(); // Libera memória
        currentBook = null;
        rendition = null;
        document.getElementById('viewer').innerHTML = ''; // Limpa a DOM
    }
    readerView.style.display = 'none';
    libraryView.style.display = 'block';
});

document.getElementById('prev-zone').addEventListener('click', () => {
    if (rendition) rendition.prev();
});

document.getElementById('next-zone').addEventListener('click', () => {
    if (rendition) rendition.next();
});

// --- Configurações (Fonte, Tema, Margem) ---
function salvarConfiguracoes() {
    localStorage.setItem('reader_settings', JSON.stringify(readerSettings));
    aplicarConfiguracoesVisuais();
}

function aplicarConfiguracoesVisuais() {
    if (!rendition) return;
    rendition.themes.fontSize(readerSettings.fontSize + "%");
    rendition.themes.select(readerSettings.theme);
    
    // Injeção de CSS nativo para forçar a margem no conteúdo iframe do Epub.js
    rendition.hooks.content.register((contents) => {
        contents.addStylesheetRules([
            ["body", ["padding", `0 ${readerSettings.margin}px !important`]]
        ]);
    });
    // Força re-renderização suave
    rendition.themes.update(readerSettings.theme); 
}

document.getElementById('btn-font-plus').addEventListener('click', () => {
    readerSettings.fontSize += 10;
    salvarConfiguracoes();
});

document.getElementById('btn-font-minus').addEventListener('click', () => {
    readerSettings.fontSize -= 10;
    salvarConfiguracoes();
});

document.getElementById('btn-theme').addEventListener('click', () => {
    readerSettings.theme = readerSettings.theme === 'light' ? 'dark' : 'light';
    // Troca também a cor de fundo do container externo
    document.getElementById('reader-view').style.background = readerSettings.theme === 'light' ? '#fff' : '#121212';
    document.getElementById('reader-toolbar').style.background = readerSettings.theme === 'light' ? '#f8f8f8' : '#1f1f1f';
    salvarConfiguracoes();
});

document.getElementById('btn-margin').addEventListener('click', () => {
    // Alterna a margem entre 10px, 20px e 40px
    if(readerSettings.margin === 10) readerSettings.margin = 20;
    else if(readerSettings.margin === 20) readerSettings.margin = 40;
    else readerSettings.margin = 10;
    salvarConfiguracoes();
});