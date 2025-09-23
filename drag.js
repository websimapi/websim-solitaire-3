export class Drag {
    constructor(game, ui, sound) {
        this.game = game;
        this.ui = ui;
        this.sound = sound;
        this.draggedCards = [];
        this.draggedElements = [];
        this.offsetX = 0;
        this.offsetY = 0;
        this.startX = 0;
        this.startY = 0;
        this.startPile = null;
        this.isDragging = false;
        this.dragStarted = false; // Track if drag actually started
        this.pointerId = null;
        this.ghosts = [];

        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
    }

    addCardListeners() {
        const cards = document.querySelectorAll('.card');
        cards.forEach(card => {
            card.removeEventListener('pointerdown', this.onPointerDown);
            card.addEventListener('pointerdown', this.onPointerDown, { passive: false });

            // Click handlers for non-drag interactions
            card.onclick = (e) => {
                if (!this.dragStarted) {
                    this.onCardClick(e, card);
                }
            };
            card.ondblclick = (e) => {
                if (!this.dragStarted) {
                    this.onCardDblClick(e, card);
                }
            };
        });

        // Prevent scrolling on the game container
        document.getElementById('game-container').addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    }

    onCardClick(e, cardElement) {
        e.stopPropagation(); // prevent game container click
        if (this.isDragging) return;

        const cardId = cardElement.dataset.id;
        const pileName = cardElement.dataset.pile;
        const [type, index] = pileName.split('-');

        if (type === 'stock') {
            this.game.dealFromStock();
            this.sound.play('deal');
            return;
        }

        if (cardElement.classList.contains('is-flipped')) {
            const pile = this.game.state.tableau[index];
            if (pile && pile.length > 0 && pile[pile.length - 1].id === cardId) {
                if (this.game.flipTableauCard(pile)) {
                    this.sound.play('deal');
                }
            }
        }
    }

    onCardDblClick(e, cardElement) {
        e.stopPropagation(); // prevent game container dblclick
        const cardId = cardElement.dataset.id;
        const { card } = this.game.getCardAndPile(cardId);
        const tableauTargets = Array.from({ length: 7 }, (_, i) => `tableau-${i}`)
            .filter(name => this.game.isValidMove(card, [cardId], name));
        let chosen = null;
        if (tableauTargets.length) {
            const cx = cardElement.getBoundingClientRect();
            const ccx = cx.left + cx.width / 2, ccy = cx.top + cx.height / 2;
            chosen = tableauTargets.reduce((best, name) => {
                const el = document.querySelector(`[data-pile="${name}"]`);
                const r = el.getBoundingClientRect();
                const px = r.left + r.width / 2, py = r.top + r.height / 2;
                const d = Math.hypot(px - ccx, py - ccy);
                return !best || d < best.d ? { name, d } : best;
            }, null)?.name;
        }
        const target = chosen || this.game.findAutoMoveTarget(cardId, 'foundation');
        if (target && this.game.moveCards([cardId], target)) {
            this.sound.play('place');
        } else {
            this.sound.play('invalid');
        }
    }

    onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this.isDragging) return;

        const cardElement = e.target.closest('.card');
        if (!cardElement) return;

        // Prevent default text selection, etc.
        e.preventDefault();
        
        const cardId = cardElement.dataset.id;
        const { pile, pileName, cardIndex } = this.game.getCardAndPile(cardId);

        if (!pile || pile.length === 0) return;

        const [pileType] = pileName.split('-');

        // Validate draggable cards
        if (pileType === 'tableau') {
            if (!pile[cardIndex].isFaceUp) return;
            const cardsToMove = pile.slice(cardIndex);
            if (cardsToMove.length === 0 || !this.game.isValidTableauSequence(cardsToMove)) return;
            this.draggedCards = cardsToMove;
        } else if (pileType === 'waste' && cardIndex === pile.length - 1) {
            this.draggedCards = [pile[cardIndex]];
        } else if (pileType === 'foundation' && cardIndex === pile.length - 1) {
            this.draggedCards = [pile[cardIndex]];
        } else {
            return;
        }
        
        e.stopPropagation();

        this.isDragging = true;
        this.dragStarted = false;
        this.pointerId = e.pointerId;

        this.startPile = pileName;
        this.draggedElements = this.draggedCards.map(c => document.querySelector(`[data-id="${c.id}"]`));

        if (this.draggedElements.length === 0 || !this.draggedElements[0]) {
            this.resetDragState();
            return;
        }

        const rect = this.draggedElements[0].getBoundingClientRect();
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.offsetX = e.clientX - rect.left;
        this.offsetY = e.clientY - rect.top;

        // Add move/up listeners
        document.addEventListener('pointermove', this.onPointerMove, { passive: false });
        document.addEventListener('pointerup', this.onPointerUp, { once: true });
        document.addEventListener('pointercancel', this.onPointerUp, { once: true });
    }

    onPointerMove(e) {
        if (!this.isDragging || e.pointerId !== this.pointerId) return;

        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;

        // Start dragging after moving a threshold distance
        if (!this.dragStarted && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            this.dragStarted = true;
            this.prepareForDrag();
        }

        if (this.dragStarted) {
            e.preventDefault();
            this.updateDraggedElementsPosition(e.clientX, e.clientY);
            this.updateDropZoneHighlight(e.clientX, e.clientY);
        }
    }

    prepareForDrag() {
        // Create ghost elements
        this.ghosts = this.draggedElements.map(el => {
            const ghost = el.cloneNode(true);
            ghost.classList.add('ghost');
            el.parentElement.insertBefore(ghost, el);
            return ghost;
        });

        this.draggedElements.forEach((el, i) => {
            el.classList.add('dragging');
            el.style.zIndex = 1000 + i;

            // Reparent to game-container for proper positioning
            const rect = el.getBoundingClientRect();
            document.getElementById('game-container').appendChild(el);
            el.style.position = 'absolute';
            el.style.left = `${rect.left}px`;
            el.style.top = `${rect.top}px`;
        });
    }

    updateDraggedElementsPosition(clientX, clientY) {
        if (this.draggedElements.length === 0) return;

        const containerRect = document.getElementById('game-container').getBoundingClientRect();
        const firstEl = this.draggedElements[0];

        // We use the initial absolute position (set in prepareForDrag) and add the delta
        const initialRect = this.ghosts[0].getBoundingClientRect();
        
        const dx = clientX - this.startX;
        const dy = clientY - this.startY;

        this.draggedElements.forEach((el, i) => {
            const yOffset = i * 25; // Stack cards with slight vertical offset
            const initialElRect = this.ghosts[i].getBoundingClientRect();
            const newLeft = initialElRect.left - containerRect.left + dx;
            const newTop = initialElRect.top - containerRect.top + dy;
            
            el.style.left = `${newLeft}px`;
            el.style.top = `${newTop}px`;
        });
    }

    updateDropZoneHighlight(x, y) {
        document.querySelectorAll('.pile').forEach(p => p.classList.remove('drop-valid', 'drop-invalid'));

        this.draggedElements.forEach(el => el.style.pointerEvents = 'none');
        const dropTarget = document.elementFromPoint(x, y)?.closest('.pile');
        this.draggedElements.forEach(el => el.style.pointerEvents = '');

        if (dropTarget && this.draggedCards.length > 0) {
            const targetPileName = dropTarget.dataset.pile;
            const isValid = this.game.isValidMove(this.draggedCards[0], this.draggedCards.map(c => c.id), targetPileName);
            dropTarget.classList.add(isValid ? 'drop-valid' : 'drop-invalid');
        }
    }

    onPointerUp(e) {
        if (!this.isDragging || e.pointerId !== this.pointerId) {
            return;
        }
        
        // Remove listeners
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointercancel', this.onPointerUp);

        if (!this.dragStarted) {
            this.resetDragState();
            return;
        }

        document.querySelectorAll('.pile').forEach(p => p.classList.remove('drop-valid', 'drop-invalid'));

        this.draggedElements.forEach(el => el.style.pointerEvents = 'none');
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pile');
        this.draggedElements.forEach(el => el.style.pointerEvents = '');

        let moveSuccessful = false;
        if (dropTarget) {
            const targetPileName = dropTarget.dataset.pile;
            moveSuccessful = this.game.moveCards(this.draggedCards.map(c => c.id), targetPileName);
        }

        if (moveSuccessful) {
            this.sound.play('place');
        } else {
            this.sound.play('invalid');
            this.snapBack();
        }

        // Don't call resetDragState immediately if snapping back, let the animation finish
        if (moveSuccessful) {
            this.resetDragState(true);
        }
    }

    snapBack() {
        this.draggedElements.forEach((el, i) => {
            if (el) {
                const ghostRect = this.ghosts[i].getBoundingClientRect();
                const containerRect = document.getElementById('game-container').getBoundingClientRect();

                el.style.transition = 'left 0.2s ease-out, top 0.2s ease-out';
                el.style.left = `${ghostRect.left - containerRect.left}px`;
                el.style.top = `${ghostRect.top - containerRect.top}px`;
            }
        });
        setTimeout(() => this.resetDragState(false), 200);
    }

    resetDragState(moveWasSuccessful) {
        // Clean up ghosts
        this.ghosts.forEach(g => g.remove());
        this.ghosts = [];

        // If move was successful, the UI.render will handle everything.
        // We just need to remove the dragging elements from the DOM as they are now stale.
        if (moveWasSuccessful) {
            this.draggedElements.forEach(el => el.remove());
        } else {
             // If move failed, put the elements back into their original pile
            const sourcePileElement = document.querySelector(`[data-pile="${this.startPile}"]`);
            if (sourcePileElement) {
                this.draggedElements.forEach(el => {
                    // Reset styles before re-attaching
                    el.classList.remove('dragging');
                    el.style.position = 'absolute';
                    el.style.zIndex = '';
                    el.style.transform = '';
                    el.style.transition = '';
                    el.style.left = '';
                    el.style.top = '';
                    sourcePileElement.appendChild(el);
                });
                // After re-attaching, force a re-render of just this pile to fix styles
                this.ui.renderPile(this.game.getPile(this.startPile), this.startPile);
            }
        }
        
        this.draggedCards = [];
        this.draggedElements = [];
        this.startPile = null;
        this.isDragging = false;
        this.dragStarted = false; // Track if drag actually started
        this.pointerId = null;
    }
}