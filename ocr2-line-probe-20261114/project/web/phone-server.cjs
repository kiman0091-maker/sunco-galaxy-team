process.env.OCR_LOW_MEMORY='1';
// Reduce retained image buffers on the memory-limited phone server.
const sharp=require('sharp');sharp.cache(false);sharp.concurrency(1);
process.env.OCR_ENGINE='local';
require('./server.cjs');
