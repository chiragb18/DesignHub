// Quick debug script - paste this in browser console to see template structure

const template = { id: '1770284421351', name: 'Lehra do T20 WC' };
// Get the template from IndexedDB
const request = indexedDB.open('BannerEditorDB');
request.onsuccess = (event) => {
    const db = event.target.result;
    const tx = db.transaction('templates', 'readonly');
    const store = tx.objectStore('templates');
    const getAllRequest = store.getAll();

    getAllRequest.onsuccess = () => {
        const templates = getAllRequest.result;
        const myTemplate = templates.find(t => t.id === '1770284421351');
        console.log('Template JSON:', myTemplate.json);
        console.log('First object:', myTemplate.json.objects[0]);

        // Check for images
        const images = myTemplate.json.objects.filter(o => o.type === 'image');
        console.log('Images found:', images.length);
        images.forEach((img, i) => {
            console.log(`Image ${i} src:`, img.src.substring(0, 100) + '...');
        });
    };
};
