const fs = require('fs');
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});

const index = pinecone.Index('research-services-index'); // update as needed

async function updateMetadataOnly() {
    try {
        const raw = fs.readFileSync('./services.json', 'utf-8');
        const services = JSON.parse(raw);

        const keysToKeep = ["regional infrastructure", "Output", "URL", "Contact"];

        for (const service of services) {
            const originalId = service['Service ID'] || service.id;
            if (!originalId) continue;

            const id = originalId.trim().replace(/\s+/g, '-');

            // Extract only selected metadata fields
            const metadata = { id };
            for (const key of keysToKeep) {
                if (service[key]) {
                    metadata[key] = service[key];
                }
            }

            // Call Pinecone update
            await index.update({
                id,
                metadata // ✅ this replaces the full metadata
            });

            console.log(`✅ Metadata updated for ${id}`);
        }

        console.log('🎉 Metadata update completed for all services.');
    } catch (err) {
        console.error('🔥 Metadata update failed:', err);
    }
}

updateMetadataOnly();