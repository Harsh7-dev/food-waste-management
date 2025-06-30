document.addEventListener('DOMContentLoaded', () => {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        window.location.href = 'auth.html';
        return;
    }

    const addItemForm = document.getElementById('add-item-form');
    const itemList = document.getElementById('item-list');
    const logoutBtn = document.getElementById('logout-btn');
    const API_URL = 'https://1h6h68c8lf.execute-api.us-east-1.amazonaws.com/dev';

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authToken');
        window.location.href = 'auth.html';
    });
    
    const addItemButton = document.querySelector('#add-item-form button[type="submit"]');
    const addItemBtnText = document.getElementById('add-item-btn-text');
    const addItemSpinner = document.getElementById('add-item-spinner');
    const inventoryLoader = document.getElementById('inventory-loader');

    const notificationToastEl = document.getElementById('notification-toast');
    const notificationToast = new bootstrap.Toast(notificationToastEl);
    const toastTitle = document.getElementById('toast-title');
    const toastBody = document.getElementById('toast-body');

    // Analytics elements
    const totalItemsEl = document.getElementById('total-items');
    const expiringSoonEl = document.getElementById('expiring-soon');
    const expiredItemsEl = document.getElementById('expired-items');
    const wastePercentageEl = document.getElementById('waste-percentage');

    function showToast(title, message, isSuccess) {
        toastTitle.innerHTML = `<i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-times-circle'} me-2"></i> ${title}`;
        toastBody.textContent = message;
        notificationToastEl.className = 'toast';
        notificationToastEl.classList.add(isSuccess ? 'bg-success' : 'bg-danger', 'text-white');
        notificationToast.show();
    }

    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        addItemBtnText.style.display = 'none';
        addItemSpinner.style.display = 'inline-block';
        addItemButton.disabled = true;

        const newItem = {
            itemName: document.getElementById('item-name').value,
            quantity: document.getElementById('item-quantity').value,
            purchaseDate: new Date().toISOString().split('T')[0],
            expiryDate: document.getElementById('expiration-date').value
        };

        try {
            const response = await fetch(`${API_URL}/items`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(newItem)
            });
            const result = await response.json();
            if (response.ok) {
                showToast('Success!', 'Item added successfully.', true);
                addItemForm.reset();
                fetchItems();
            } else {
                showToast('Error', result.message || 'Failed to add item.', false);
            }
        } catch (error) {
            showToast('Error', 'An error occurred.', false);
        } finally {
            addItemBtnText.style.display = 'inline-block';
            addItemSpinner.style.display = 'none';
            addItemButton.disabled = false;
        }
    });

    async function fetchItems() {
        inventoryLoader.style.display = 'block';
        itemList.style.display = 'none';
        try {
            const response = await fetch(`${API_URL}/items`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const items = await response.json();
            itemList.innerHTML = '';
            if (items.length === 0) {
                itemList.innerHTML = '<li class="list-group-item text-center text-muted">Your inventory is empty.</li>';
            } else {
                items.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
                items.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'list-group-item d-flex justify-content-between align-items-center list-item-hover';
                    const expiration = new Date(item.expiryDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const daysUntilExpiration = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));
                    
                    let badgeClass = 'bg-success';
                    let badgeText = `Expires in ${daysUntilExpiration} days`;

                    if (daysUntilExpiration < 0) {
                        badgeClass = 'bg-danger';
                        badgeText = 'Expired';
                    } else if (daysUntilExpiration <= 3) {
                        badgeClass = 'bg-danger';
                    } else if (daysUntilExpiration <= 7) {
                        badgeClass = 'bg-warning text-dark';
                    }

                    li.innerHTML = `
                        <div>
                            <h6 class="mb-0"><i class="fas fa-box-open me-2 text-muted"></i>${item.itemName}</h6>
                            <small class="text-muted">Quantity: ${item.quantity} &bull; Added: ${new Date(item.createdAt).toLocaleDateString()}</small>
                        </div>
                        <div class="d-flex align-items-center">
                            <span class="badge ${badgeClass} rounded-pill me-3">
                                <i class="fas fa-clock me-1"></i>${badgeText}
                            </span>
                            <button class="btn btn-sm btn-outline-danger delete-btn" data-item-id="${item.itemId}">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>`;
                    itemList.appendChild(li);
                });
            }
            // Update analytics after fetching items
            fetchAnalytics();
        } catch (error) {
            itemList.innerHTML = '<li class="list-group-item text-center text-danger">Could not load items.</li>';
        } finally {
            inventoryLoader.style.display = 'none';
            itemList.style.display = 'block';
        }
    }

    itemList.addEventListener('click', async (e) => {
        if (e.target.closest('.delete-btn')) {
            const button = e.target.closest('.delete-btn');
            const itemId = button.dataset.itemId;
            
            if (confirm('Are you sure you want to delete this item?')) {
                try {
                    const response = await fetch(`${API_URL}/items/${itemId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });

                    if (response.ok) {
                        showToast('Success', 'Item deleted successfully.', true);
                        fetchItems();
                    } else {
                        const result = await response.json();
                        showToast('Error', result.message || 'Failed to delete item.', false);
                    }
                } catch (error) {
                    showToast('Error', 'An error occurred while deleting the item.', false);
                }
            }
        }
    });

    async function fetchAnalytics() {
        try {
            const response = await fetch(`${API_URL}/analytics`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const analytics = await response.json();
            
            if (response.ok) {
                totalItemsEl.textContent = analytics.totalItems;
                expiringSoonEl.textContent = analytics.expiringSoon;
                expiredItemsEl.textContent = analytics.expiredItems;
                wastePercentageEl.textContent = `${analytics.wastePercentage}%`;
            }
        } catch (error) {
            console.error('Error fetching analytics:', error);
        }
    }

    fetchItems();
});

// Map loading state management
let mapInitialized = false;
let markersFound = 0;

function initMap() {
    const mapLoading = document.getElementById('map-loading');
    const mapError = document.getElementById('map-error');
    
    // Show loading state
    if (mapLoading) mapLoading.style.display = 'block';
    if (mapError) mapError.style.display = 'none';
    
    const defaultLocation = { lat: 40.7128, lng: -74.0060 }; // New York City
    const map = new google.maps.Map(document.getElementById('map'), { 
        center: defaultLocation, 
        zoom: 12, 
        styles: [{elementType:"geometry",stylers:[{color:"#f5f5f5"}]},{elementType:"labels.icon",stylers:[{visibility:"off"}]},{elementType:"labels.text.fill",stylers:[{color:"#616161"}]},{elementType:"labels.text.stroke",stylers:[{color:"#f5f5f5"}]},{featureType:"administrative.land_parcel",stylers:[{visibility:"off"}]},{featureType:"poi",elementType:"geometry",stylers:[{color:"#eeeeee"}]},{featureType:"poi",elementType:"labels.text.fill",stylers:[{color:"#757575"}]},{featureType:"poi.park",elementType:"geometry",stylers:[{color:"#e5e5e5"}]},{featureType:"road",elementType:"geometry",stylers:[{color:"#ffffff"}]},{featureType:"road.arterial",elementType:"labels.text.fill",stylers:[{color:"#757575"}]},{featureType:"road.highway",elementType:"geometry",stylers:[{color:"#dadada"}]},{featureType:"road.highway",elementType:"labels.text.fill",stylers:[{color:"#616161"}]},{featureType:"road.local",elementType:"labels.text.fill",stylers:[{color:"#9e9e9e"}]},{featureType:"transit.line",elementType:"geometry",stylers:[{color:"#e5e5e5"}]},{featureType:"transit.station",elementType:"geometry",stylers:[{color:"#eeeeee"}]},{featureType:"water",elementType:"geometry",stylers:[{color:"#c9c9c9"}]},{featureType:"water",elementType:"labels.text.fill",stylers:[{color:"#9e9e9e"}]}] 
    });
    
    // Add a default marker to show the map is working
    new google.maps.Marker({
        position: defaultLocation,
        map: map,
        title: 'Default Location (New York)',
        icon: { url: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' }
    });
    
    if (navigator.geolocation) {
        console.log('Geolocation is supported, getting user location...');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                console.log('User location obtained:', pos.coords);
                const userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                map.setCenter(userLocation);
                
                // Add user location marker
                new google.maps.Marker({
                    position: userLocation,
                    map: map,
                    title: 'Your Location',
                    icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' }
                });
                
                searchNearbyFoodBanks(userLocation, map);
            }, 
            (error) => {
                console.error('Geolocation error:', error);
                console.log('Using default location (New York)');
                searchNearbyFoodBanks(defaultLocation, map);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    } else {
        console.log('Geolocation not supported, using default location');
        searchNearbyFoodBanks(defaultLocation, map);
    }
    
    mapInitialized = true;
}

function searchNearbyFoodBanks(location, map) {
    console.log('Searching for food banks near:', location);
    markersFound = 0;
    
    const service = new google.maps.places.PlacesService(map);
    
    // Expanded search terms to find more results
    const searchTerms = [
        'food bank',
        'food pantry', 
        'soup kitchen',
        'charity food',
        'food assistance',
        'community food',
        'food donation',
        'food shelf',
        'food cupboard',
        'emergency food',
        'food rescue',
        'food distribution'
    ];
    
    let completedSearches = 0;
    
    searchTerms.forEach((term, index) => {
        setTimeout(() => {
            service.nearbySearch({ 
                location: location, 
                radius: '15000', // Increased radius to 15km
                keyword: term,
                type: ['establishment']
            }, (results, status) => {
                completedSearches++;
                console.log(`Search for "${term}":`, status, results ? results.length : 0, 'results');
                
                if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                    results.forEach(place => {
                        // Filter out duplicates and non-relevant places
                        if (isRelevantFoodService(place, term)) {
                            createMarker(place, map, term);
                            markersFound++;
                        }
                    });
                } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                    console.log(`No results found for "${term}"`);
                } else if (status === google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
                    console.error('Google Places API query limit exceeded');
                    showMapError('API query limit exceeded. Please try again later.');
                } else if (status === google.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
                    console.error('Google Places API request denied - check API key permissions');
                    showMapError('Google Maps API access denied. Please check configuration.');
                } else {
                    console.error(`Google Places API error for "${term}":`, status);
                }
                
                // Check if all searches are complete
                if (completedSearches === searchTerms.length) {
                    finishMapLoading();
                }
            });
        }, index * 800); // Reduced delay to 800ms
    });
    
    // Also try a text search as backup
    setTimeout(() => {
        service.textSearch({
            query: 'food bank food pantry soup kitchen',
            location: location,
            radius: 15000
        }, (results, status) => {
            console.log('Text search results:', status, results ? results.length : 0, 'results');
            
            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                results.forEach(place => {
                    if (isRelevantFoodService(place, 'text search')) {
                        createMarker(place, map, 'text search');
                        markersFound++;
                    }
                });
            }
        });
    }, 5000); // Run text search after 5 seconds
}

function isRelevantFoodService(place, searchTerm) {
    const name = place.name.toLowerCase();
    const types = place.types || [];
    
    // Keywords that indicate food assistance services
    const foodServiceKeywords = [
        'food bank', 'food pantry', 'soup kitchen', 'charity', 'donation',
        'assistance', 'community', 'emergency', 'rescue', 'distribution',
        'shelf', 'cupboard', 'mission', 'outreach', 'ministry'
    ];
    
    // Check if place name contains relevant keywords
    const hasRelevantName = foodServiceKeywords.some(keyword => 
        name.includes(keyword)
    );
    
    // Check if place types are relevant
    const hasRelevantType = types.some(type => 
        ['establishment', 'food', 'charity', 'non_profit'].includes(type)
    );
    
    // Exclude obviously non-relevant places
    const excludeKeywords = ['restaurant', 'cafe', 'pizza', 'burger', 'taco', 'sushi'];
    const shouldExclude = excludeKeywords.some(keyword => 
        name.includes(keyword)
    );
    
    return (hasRelevantName || hasRelevantType) && !shouldExclude;
}

function createMarker(place, map, searchTerm) {
    if (!place.geometry || !place.geometry.location) {
        console.log('Place missing geometry:', place.name);
        return;
    }
    
    console.log('Creating marker for:', place.name, 'at', place.geometry.location);
    
    const marker = new google.maps.Marker({ 
        position: place.geometry.location, 
        map: map, 
        title: place.name,
        icon: { url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' }
    });
    
    // Add info window with place details
    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="padding: 10px;">
                <h6 style="margin: 0 0 5px 0; color: #28a745;">${place.name}</h6>
                ${place.vicinity ? `<p style="margin: 0; font-size: 12px; color: #666;">${place.vicinity}</p>` : ''}
                ${place.rating ? `<p style="margin: 5px 0 0 0; font-size: 12px;">Rating: ${place.rating} ⭐</p>` : ''}
                <p style="margin: 5px 0 0 0; font-size: 11px; color: #28a745;">Found via: ${searchTerm}</p>
            </div>
        `
    });
    
    marker.addListener('click', () => {
        infoWindow.open(map, marker);
    });
}

function finishMapLoading() {
    const mapLoading = document.getElementById('map-loading');
    const mapError = document.getElementById('map-error');
    
    if (mapLoading) mapLoading.style.display = 'none';
    
    if (markersFound === 0) {
        console.log('No food banks found in the area');
        showMapError('No food banks found in your area. Try expanding your search or check back later.');
        
        // Add fallback information
        addFallbackResources();
    } else {
        console.log(`Found ${markersFound} food banks`);
        if (mapError) mapError.style.display = 'none';
    }
}

function addFallbackResources() {
    const mapError = document.getElementById('map-error');
    if (!mapError) return;
    
    const errorContent = mapError.querySelector('.text-center');
    if (errorContent) {
        errorContent.innerHTML = `
            <i class="fas fa-exclamation-triangle text-warning fa-2x mb-2"></i>
            <h6>No Local Food Banks Found</h6>
            <p class="mb-2">We couldn't find food banks in your immediate area. Here are some alternatives:</p>
            <div class="text-start small mb-3">
                <h6 class="text-primary">Alternative Options:</h6>
                <ul>
                    <li><strong>Local Churches</strong> - Many churches have food assistance programs</li>
                    <li><strong>Community Centers</strong> - Check your local community center</li>
                    <li><strong>Social Services</strong> - Contact your city's social services department</li>
                    <li><strong>Online Resources</strong> - Use websites like Feeding America</li>
                </ul>
                <h6 class="text-success">Quick Actions:</h6>
                <ul>
                    <li>Search "food bank [your city]" on Google</li>
                    <li>Call 211 for local assistance programs</li>
                    <li>Check with local grocery stores for donation programs</li>
                </ul>
            </div>
            <button id="retry-map" class="btn btn-primary btn-sm me-2">
                <i class="fas fa-redo me-1"></i>Retry Search
            </button>
            <button id="expand-search" class="btn btn-success btn-sm">
                <i class="fas fa-search-plus me-1"></i>Expand Search
            </button>
        `;
        
        // Add event listener for expand search
        const expandButton = document.getElementById('expand-search');
        if (expandButton) {
            expandButton.addEventListener('click', () => {
                expandSearchRadius();
            });
        }
    }
}

function expandSearchRadius() {
    const mapError = document.getElementById('map-error');
    if (mapError) mapError.style.display = 'none';
    
    // Re-run search with larger radius
    if (mapInitialized) {
        const map = new google.maps.Map(document.getElementById('map'));
        const currentCenter = map.getCenter();
        
        if (currentCenter) {
            searchNearbyFoodBanks(currentCenter, map);
        }
    }
}

function showMapError(message) {
    const mapLoading = document.getElementById('map-loading');
    const mapError = document.getElementById('map-error');
    
    if (mapLoading) mapLoading.style.display = 'none';
    if (mapError) {
        mapError.style.display = 'block';
        const errorText = mapError.querySelector('p');
        if (errorText) errorText.textContent = message;
    }
}

// Add retry functionality
document.addEventListener('DOMContentLoaded', () => {
    const retryButton = document.getElementById('retry-map');
    if (retryButton) {
        retryButton.addEventListener('click', () => {
            if (mapInitialized) {
                initMap();
            }
        });
    }
}); 