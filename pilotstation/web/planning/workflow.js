/**
 * PilotStation — Workflow Controller
 * Manages the 6-step planning flow: Aircraft → Route → Weather → W&B → Briefing → Ready
 * PLAN-01, PLAN-03 (auto-save/resume)
 */

class WorkflowController {
    static STEPS = [
        { num: 1, id: 'aircraft', label: 'AIRCRAFT', module: () => AircraftStep },
        { num: 2, id: 'route', label: 'ROUTE', module: () => RouteStep },
        { num: 3, id: 'weather', label: 'WEATHER', module: () => WeatherStep },
        { num: 4, id: 'wb', label: 'W&B', module: () => WbStep },
        { num: 5, id: 'briefing', label: 'BRIEF', module: () => BriefingStep },
        { num: 6, id: 'ready', label: 'READY', module: () => ReadyStep },
    ];

    constructor({ container, navButtons, onStepChange, onDataChange }) {
        this.container = container;
        this.navButtons = navButtons;
        this.onStepChange = onStepChange;
        this.onDataChange = onDataChange;

        this.currentStep = 1;
        this.completedSteps = new Set();
        this.stepInstances = {};
        this.workflowData = {};

        this._db = new NasrDB();
        this._saveTimer = null;
        this._active = false;
    }

    async activate() {
        this._active = true;
        await this._db.open();

        // Try to resume from IndexedDB (PLAN-03)
        const saved = await this._loadSavedState();
        if (saved) {
            this.workflowData = saved.data || {};
            this.currentStep = saved.currentStep || 1;
            this.completedSteps = new Set(saved.completedSteps || []);
        }

        this._renderStep(this.currentStep);
        this._updateNavState();
    }

    deactivate() {
        this._active = false;
        this._saveState();
        if (this._saveTimer) clearTimeout(this._saveTimer);
    }

    goToStep(num) {
        if (num < 1 || num > 6) return;
        if (num === this.currentStep) return;

        // Save current step data before leaving
        this._collectCurrentStepData();

        // Notify current step it's being left
        const currentInstance = this.stepInstances[this.currentStep];
        if (currentInstance && currentInstance.onLeave) {
            currentInstance.onLeave();
        }

        this.currentStep = num;
        this._renderStep(num);
        this._updateNavState();
        this.onStepChange(num);
        this._scheduleSave();
    }

    next() {
        if (this.currentStep >= 6) return;

        // Validate current step before allowing forward
        const instance = this.stepInstances[this.currentStep];
        if (instance && instance.validate) {
            const valid = instance.validate();
            if (!valid) return;
        }

        // Mark current step as completed
        this.completedSteps.add(this.currentStep);
        this._collectCurrentStepData();
        this.goToStep(this.currentStep + 1);
    }

    prev() {
        if (this.currentStep <= 1) return;
        this._collectCurrentStepData();
        this.goToStep(this.currentStep - 1);
    }

    /**
     * Get the full workflow data assembled from all steps.
     */
    getWorkflowData() {
        this._collectCurrentStepData();
        return { ...this.workflowData };
    }

    /**
     * Notify the controller that data has changed (called by step modules).
     */
    dataChanged(stepId, data) {
        this.workflowData[stepId] = data;
        this.onDataChange(this.workflowData);
        this._scheduleSave();
    }

    // ========== Internal ==========

    _renderStep(num) {
        const stepDef = WorkflowController.STEPS.find(s => s.num === num);
        if (!stepDef) return;

        this.container.innerHTML = '';

        // Create step header with prev/next buttons
        const header = document.createElement('div');
        header.className = 'step-header flex justify-between items-center mb-md';
        header.innerHTML = `
            <button class="btn btn-secondary step-prev" ${num <= 1 ? 'disabled' : ''}>
                &larr; ${num > 1 ? WorkflowController.STEPS[num - 2].label : ''}
            </button>
            <h2 class="step-title">Step ${num}: ${stepDef.label}</h2>
            <button class="btn btn-primary step-next" ${num >= 6 ? 'disabled' : ''}>
                ${num < 6 ? WorkflowController.STEPS[num].label : 'DONE'} &rarr;
            </button>
        `;
        this.container.appendChild(header);

        header.querySelector('.step-prev').addEventListener('click', () => this.prev());
        header.querySelector('.step-next').addEventListener('click', () => this.next());

        // Create step content container
        const stepContainer = document.createElement('div');
        stepContainer.className = 'step-body';
        this.container.appendChild(stepContainer);

        // Instantiate or reuse step module
        let instance = this.stepInstances[num];
        const StepClass = stepDef.module();

        if (!instance && StepClass) {
            instance = new StepClass({
                controller: this,
                db: this._db,
            });
            this.stepInstances[num] = instance;
        }

        if (instance && instance.render) {
            instance.render(stepContainer, this.workflowData);
        }

        if (instance && instance.onEnter) {
            instance.onEnter(this.workflowData);
        }
    }

    _collectCurrentStepData() {
        const instance = this.stepInstances[this.currentStep];
        if (instance && instance.getData) {
            const stepDef = WorkflowController.STEPS.find(s => s.num === this.currentStep);
            const data = instance.getData();
            if (data && stepDef) {
                this.workflowData[stepDef.id] = data;
            }
        }
    }

    _updateNavState() {
        this.navButtons.forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.classList.toggle('active', step === this.currentStep);
            btn.classList.toggle('completed', this.completedSteps.has(step));
        });
    }

    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveState(), 2000);
    }

    async _saveState() {
        try {
            await this._db.setMeta('workflow_state', {
                currentStep: this.currentStep,
                completedSteps: [...this.completedSteps],
                data: this.workflowData,
                savedAt: new Date().toISOString(),
            });
        } catch (err) {
            console.warn('Failed to save workflow state:', err);
        }
    }

    async _loadSavedState() {
        try {
            return await this._db.getMeta('workflow_state');
        } catch {
            return null;
        }
    }
}
