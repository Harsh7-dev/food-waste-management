document.addEventListener('DOMContentLoaded', () => {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        window.location.href = 'auth.html';
        return;
    }

    const logoutBtn = document.getElementById('logout-btn');
    const startScanBtn = document.getElementById('start-scan-btn');
    const stopScanBtn = document.getElementById('stop-scan-btn');
    const testBarcodeBtn = document.getElementById('test-barcode-btn');
    const scannerVideo = document.getElementById('scanner-video');
    const scanResult = document.getElementById('scan-result');
    const barcodeResult = document.getElementById('barcode-result');
    const manualEntryForm = document.getElementById('manual-entry-form');
    const API_URL = 'https://1h6h68c8lf.execute-api.us-east-1.amazonaws.com/dev';

    let codeReader = null;
    let stream = null;

    // Toast notification setup
    const notificationToastEl = document.getElementById('notification-toast');
    const notificationToast = new bootstrap.Toast(notificationToastEl);
    const toastTitle = document.getElementById('toast-title');
    const toastBody = document.getElementById('toast-body');

    function showToast(title, message, isSuccess) {
        toastTitle.innerHTML = `<i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-times-circle'} me-2"></i> ${title}`;
        toastBody.textContent = message;
        notificationToastEl.className = 'toast';
        notificationToastEl.classList.add(isSuccess ? 'bg-success' : 'bg-danger', 'text-white');
        notificationToast.show();
    }

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authToken');
        window.location.href = 'auth.html';
    });

    // Barcode Scanner Functions
    async function startScanner() {
        try {
            codeReader = new ZXing.BrowserMultiFormatReader();
            
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            
            scannerVideo.srcObject = stream;
            scannerVideo.play();

            codeReader.decodeFromVideoDevice(null, 'scanner-video', async (result, err) => {
                if (result) {
                    const barcode = result.text;
                    barcodeResult.textContent = barcode;
                    scanResult.style.display = 'block';
                    
                    // Auto-fill manual form with scanned barcode
                    document.getElementById('manual-barcode').value = barcode;
                    
                    // Fetch and display product data
                    const productData = await fetchProductData(barcode);
                    
                    if (productData) {
                        // Auto-fill product name
                        document.getElementById('manual-item-name').value = productData.name;
                        
                        // Display product information
                        displayProductInfo(productData);
                        
                        showToast('Success!', `Product found: ${productData.name}`, true);
                    } else {
                        // Clear any previous product info
                        displayProductInfo(null);
                        showToast('Info', 'Product not found in database. Please enter details manually.', true);
                    }
                    
                    // Stop scanning after successful scan
                    stopScanner();
                }
                if (err && !(err instanceof ZXing.NotFoundException)) {
                    console.error('Scanning error:', err);
                }
            });

            startScanBtn.style.display = 'none';
            stopScanBtn.style.display = 'inline-block';
            
        } catch (error) {
            console.error('Error starting scanner:', error);
            showToast('Error', 'Could not access camera. Please check permissions.', false);
        }
    }

    function stopScanner() {
        if (codeReader) {
            codeReader.reset();
            codeReader = null;
        }
        
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        
        scannerVideo.srcObject = null;
        startScanBtn.style.display = 'inline-block';
        stopScanBtn.style.display = 'none';
    }

    startScanBtn.addEventListener('click', startScanner);
    stopScanBtn.addEventListener('click', stopScanner);

    // Test Product Lookup
    testBarcodeBtn.addEventListener('click', async () => {
        const testBarcode = prompt('Enter a barcode to test (e.g., 3017620422003 for Nutella):');
        if (testBarcode) {
            barcodeResult.textContent = testBarcode;
            scanResult.style.display = 'block';
            document.getElementById('manual-barcode').value = testBarcode;
            
            const productData = await fetchProductData(testBarcode);
            
            if (productData) {
                document.getElementById('manual-item-name').value = productData.name;
                displayProductInfo(productData);
                showToast('Success!', `Product found: ${productData.name}`, true);
            } else {
                displayProductInfo(null);
                showToast('Info', 'Product not found in database. Please enter details manually.', true);
            }
        }
    });

    // Manual Entry Form
    manualEntryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            itemName: document.getElementById('manual-item-name').value,
            quantity: document.getElementById('manual-quantity').value,
            purchaseDate: new Date().toISOString().split('T')[0],
            expiryDate: document.getElementById('manual-expiry').value
        };

        try {
            const response = await fetch(`${API_URL}/items`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showToast('Success!', 'Item added successfully.', true);
                manualEntryForm.reset();
                scanResult.style.display = 'none';
            } else {
                showToast('Error', result.message || 'Failed to add item.', false);
            }
        } catch (error) {
            showToast('Error', 'An error occurred while adding the item.', false);
        }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        stopScanner();
    });

    // Product Data Fetching Function
    async function fetchProductData(barcode) {
        try {
            showToast('Loading...', 'Fetching product information...', true);
            
            const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const data = await response.json();
            
            if (data.status === 1 && data.product) {
                const product = data.product;
                return {
                    name: product.product_name || product.generic_name || 'Unknown Product',
                    brand: product.brands || '',
                    image: product.image_url || '',
                    ingredients: product.ingredients_text || '',
                    nutrition: product.nutriments || {},
                    categories: product.categories || ''
                };
            } else {
                return null;
            }
        } catch (error) {
            console.error('Error fetching product data:', error);
            return null;
        }
    }

    // Display Product Information
    function displayProductInfo(product) {
        const productInfoContainer = document.getElementById('product-info');
        if (!productInfoContainer) return;

        if (product) {
            productInfoContainer.innerHTML = `
                <div class="card mb-3">
                    <div class="card-body">
                        <div class="row">
                            ${product.image ? `
                                <div class="col-md-3">
                                    <img src="${product.image}" alt="${product.name}" class="img-fluid rounded" style="max-height: 100px;">
                                </div>
                            ` : ''}
                            <div class="col-md-${product.image ? '9' : '12'}">
                                <h6 class="card-title">${product.name}</h6>
                                ${product.brand ? `<p class="card-text"><small class="text-muted">Brand: ${product.brand}</small></p>` : ''}
                                ${product.categories ? `<p class="card-text"><small class="text-muted">Category: ${product.categories.split(',')[0]}</small></p>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
            productInfoContainer.style.display = 'block';
        } else {
            productInfoContainer.style.display = 'none';
        }
    }
}); 