import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import fs from 'fs';
import csvParser from 'csv-parser';
import { parse } from 'json2csv';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3080;

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

// Ruta principal
app.get('/', (req, res) => {
    res.render('index');
});

// COMPARE FEATURES!
app.post('/uploadcsvcompare', upload.single('csvFile'), async (req, res) => {
    const filePath = req.file.path;
    const customerId = req.body.customerId;
    const productCodesCSV = new Map(); 
    const productsWithStatus = [];

    fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (data) => {
            const productCode = data['Product Code']?.trim()
            .replace(/%20/g, ' ')
            .replace(/%22/g, '"');
                    const featureOption = data['Feature and Option']?.trim();
            if (productCode && !productCode.toLowerCase().includes("totals") && productCode.toLowerCase() !== "product code") {
                if (!productCodesCSV.has(productCode)) {
                    productCodesCSV.set(productCode, new Set());
                }
                
                productCodesCSV.get(productCode).add(featureOption);
            }
        })
        .on('end', async () => {
            try {
                for (const [code, csvOptions] of productCodesCSV.entries()) {
                    try {
                        const apiUrl = `https://content.cylindo.com/api/v2/${customerId}/products/${encodeURIComponent(code)}/configuration`;
                        const response = await axios.get(apiUrl);
                        const productData = response.data;

                        const apiFeatures = productData.features.map(f => f.code);
                        const apiOptions = productData.features.flatMap(f => f.options.map(o => o.code));

                        const missingFeatures = Array.from(csvOptions).filter(opt => !apiFeatures.includes(opt.split(':')[0]));
                        const missingOptions = Array.from(new Set(Array.from(csvOptions).flatMap(optString => {
                            return optString.split(',').map(opt => {
                                const [feature, option] = opt.split(':').map(s => s.trim().toLowerCase());
                                return (apiFeatures.map(f => f.toLowerCase()).includes(feature) && 
                                        apiOptions.map(o => o.toLowerCase()).includes(option)) 
                                    ? null 
                                    : `${feature}:${option}`;
                            }).filter(Boolean);
                        }))) || ['None'];
                        
                        
                        
                        
                        productsWithStatus.push({
                            productCode: code,
                            missingFeatures,
                            missingOptions
                        });
                    } catch (error) {
                        if (error.response && error.response.status === 404) {
                            // Agregar el producto con mensaje de no encontrado
                            productsWithStatus.push({
                                productCode: code,
                                missingFeatures: ['Product not found in Cylindo'],
                                missingOptions: ['Product not found in Cylindo']
                            });
                        } else {
                            console.error(`Error al buscar el producto ${code}:`, error);
                        }
                    }
                }
                res.render('csvcomparefeatures', { productsWithStatus });
            } catch (error) {
                console.error('Error:', error);
                res.status(500).send('Error procesando los datos.');
            }
        });
});


// COMPARAR PRODUCTOS!
app.post('/uploadcsvcomparefeatures', upload.single('csvFile'), async (req, res) => {
    const filePath = req.file.path;
    const customerId = req.body.customerId;
    const productCodesCSV = new Set();
    const productsWithStatus = [];
    
    fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (data) => {
            const productCode = data['Product Code']?.trim();
            if (productCode && !productCode.toLowerCase().includes("totals") && productCode.toLowerCase() !== "product code") {
                productCodesCSV.add(productCode);
            }
        })
        .on('end', async () => {
            try {
                // Obtener la lista completa de productos desde la API de Cylindo
                const apiUrl = `https://content.cylindo.com/api/v2/${customerId}/listcustomerproducts`;
                const response = await axios.get(apiUrl);
                const cylindoProducts = response.data.products;
                const cylindoProductCodes = new Set(cylindoProducts.map(product => product.code));
    
                // Crear la tabla con información sobre la existencia en el CSV
                for (const product of cylindoProducts) {
                    const productCode = product.code;
    
                    // Verificar si el producto está en el CSV
                    if (productCodesCSV.has(productCode)) {
                        productsWithStatus.push({
                            productCode,
                            status: "Exists in CSV and Cylindo",
                        });
                    } else {
                        productsWithStatus.push({
                            productCode,
                            status: "Missing in CSV",
                        });
                    }
                }
    
                // Verificar productos que están en el CSV pero no en Cylindo
                for (const productCode of productCodesCSV) {
                    if (!cylindoProductCodes.has(productCode)) {
                        productsWithStatus.push({
                            productCode,
                            status: "Exists in CSV but Missing in Cylindo",
                        });
                    }
                }
    
                // Renderizar la tabla con los datos
                res.render('csvcompareproducts', { productsWithStatus });
            } catch (error) {
                console.error('Error:', error);
                res.status(500).send('Error procesando los datos.');
            }
        });
});



app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
