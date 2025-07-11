            // Type definitions for better code clarity
            
            /**
             * @typedef {Object} CursorState
             * @property {number} x - X coordinate
             * @property {number} y - Y coordinate
             * @property {boolean} clicking - Whether cursor is clicking
             */

            /**
             * @typedef {Object} AppState
             * @property {boolean} loadingComplete - Whether loading is finished
             * @property {boolean} profileEntryVisible - Whether profile entry is visible
             * @property {boolean} mainContentVisible - Whether main content is visible
             */

            // Application state
            /** @type {AppState} */
            const appState = {
                loadingComplete: false,
                profileEntryVisible: false,
                mainContentVisible: false
            };

            // Custom cursor management
            /** @type {HTMLElement | null} */
            const cursor = document.getElementById('cursor');
            
            /** @type {CursorState} */
            const cursorState = {
                x: 0,
                y: 0,
                clicking: false
            };

            /** @type {Array<{x: number, y: number, element: HTMLElement}>} */
            const cursorTrail = [];
            const maxTrailLength = 8;

            /**
             * Creates a cursor trail element
             * @param {number} x - X coordinate
             * @param {number} y - Y coordinate
             * @returns {HTMLElement}
             */
            function createTrailElement(x, y) {
                const trail = document.createElement('div');
                trail.className = 'cursor-trail';
                trail.style.left = `${x - 2}px`;
                trail.style.top = `${y - 2}px`;
                document.body.appendChild(trail);
                
                // Remove trail element after animation
                setTimeout(() => {
                    trail.classList.add('fade');
                    setTimeout(() => {
                        if (trail.parentNode) {
                            trail.parentNode.removeChild(trail);
                        }
                    }, 300);
                }, 50);
                
                return trail;
            }

            /**
             * Updates cursor position based on mouse coordinates
             * @param {MouseEvent} event - Mouse event object
             * @returns {void}
             */
            function updateCursorPosition(event) {
                if (!cursor) return;
                
                cursorState.x = event.clientX;
                cursorState.y = event.clientY;
                cursor.style.left = `${cursorState.x - 16}px`;
                cursor.style.top = `${cursorState.y - 16}px`;
                
                // Add trail effect
                if (Math.random() > 0.7) { // Reduce trail frequency for performance
                    createTrailElement(cursorState.x, cursorState.y);
                }
            }

            /**
             * Sets cursor clicking state with enhanced effects
             * @param {boolean} isClicking - Whether cursor is clicking
             * @returns {void}
             */
            function setCursorClicking(isClicking) {
                if (!cursor) return;
                
                cursorState.clicking = isClicking;
                cursor.classList.toggle('clicking', isClicking);
                
                // Create burst effect on click
                if (isClicking) {
                    for (let i = 0; i < 6; i++) {
                        setTimeout(() => {
                            const offsetX = (Math.random() - 0.5) * 30;
                            const offsetY = (Math.random() - 0.5) * 30;
                            createTrailElement(cursorState.x + offsetX, cursorState.y + offsetY);
                        }, i * 30);
                    }
                }
            }

            // Event listeners for cursor
            document.addEventListener('mousemove', updateCursorPosition);
            document.addEventListener('mousedown', () => setCursorClicking(true));
            document.addEventListener('mouseup', () => setCursorClicking(false));

            /**
             * Simulates loading time with a promise
             * @param {number} [duration=2000] - Loading duration in milliseconds
             * @returns {Promise<void>}
             */
            function simulateLoading(duration = 2000) {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve();
                    }, duration);
                });
            }

            /**
             * Creates typewriter effect for text
             * @param {HTMLElement} element - Target element
             * @param {string} text - Text to type
             * @param {number} [speed=80] - Typing speed in milliseconds
             * @returns {Promise<void>}
             */
            function typeWriter(element, text, speed = 80) {
                return new Promise((resolve) => {
                    let i = 0;
                    element.textContent = '';
                    
                    function type() {
                        if (i < text.length) {
                            element.textContent += text.charAt(i);
                            i++;
                            setTimeout(type, speed + Math.random() * 40); // Add randomness for more realistic typing
                        } else {
                            resolve();
                        }
                    }
                    
                    type();
                });
            }

            /**
             * Shows the profile entry screen after hiding loading screen
             * @returns {void}
             */
            function showProfileEntry() {
                const loadingScreen = document.getElementById('loadingScreen');
                const profileEntry = document.getElementById('profileEntry');
                const profileText = document.getElementById('profileText');
                
                if (!loadingScreen || !profileEntry || !profileText) {
                    console.error('Required elements not found');
                    return;
                }
                
                loadingScreen.classList.add('hidden');
                
                setTimeout(() => {
                    profileEntry.classList.add('visible');
                    appState.profileEntryVisible = true;
                    
                    // Start typewriter effect
                    setTimeout(() => {
                        typeWriter(profileText, 'Click anywhere to view profile...');
                    }, 500);
                }, 500);
            }

            /**
             * Transitions from profile entry to main content
             * @returns {void}
             */
            function enterProfile() {
                const profileEntry = document.getElementById('profileEntry');
                const mainContent = document.getElementById('mainContent');
                
                if (!profileEntry || !mainContent) {
                    console.error('Required elements not found');
                    return;
                }
                
                profileEntry.classList.remove('visible');
                appState.profileEntryVisible = false;
                
                setTimeout(() => {
                    mainContent.classList.add('visible');
                    appState.mainContentVisible = true;
                    initializeFluidSimulation();
                }, 500);
            }

            /**
             * Initializes the fluid simulation and loads required scripts
             * @returns {void}
             */
            function initializeFluidSimulation() {
                console.log('Fluid simulation initialized');
                
                // Load the animated cursor script if needed
                const script = document.createElement('script');
                script.src = './saito/animatedCursor.js';
                
                /**
                 * Handles successful script loading
                 * @returns {void}
                 */
                script.onload = () => {
                    console.log('Animated cursor loaded');
                };
                
                /**
                 * Handles script loading errors
                 * @param {Event} error - Error event
                 * @returns {void}
                 */
                script.onerror = (error) => {
                    console.warn('Could not load animated cursor:', error);
                };
                
                document.head.appendChild(script);
            }

            /**
             * Handles application startup and loading sequence
             * @returns {Promise<void>}
             */
            async function startApplication() {
                try {
                    await simulateLoading();
                    appState.loadingComplete = true;
                    showProfileEntry();
                } catch (error) {
                    console.error('Loading error:', error);
                    // Show profile entry anyway as fallback
                    showProfileEntry();
                }
            }

            // Start the application when page loads
            window.addEventListener('load', startApplication);

            // Make enterProfile available globally for onclick
            window.enterProfile = enterProfile;