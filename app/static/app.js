// CompteApp - Personal Finance SPA Logic
document.addEventListener("DOMContentLoaded", () => {
    // State management
    const state = {
        currentView: "dashboard",
        year: new Date().getFullYear(),
        selectedMonth: null,
        categories: [],
        accounts: [],
        rules: [],
        transactions: [],
        totalTransactions: 0,
        txLimit: 25,
        txOffset: 0,
        txFilters: {
            search: "",
            month: "",
            account_id: "",
            category: "",
            type: "",
            date_from: "",
            date_to: ""
        },
        charts: {
            flux: null,
            categories: null
        },
        pollingInterval: null,
        isPollingActive: false
    };

    // Initialize SPA
    initSPA();

    // -------------------------------------------------------------
    // SPA ROUTER & INIT
    // -------------------------------------------------------------
    function initSPA() {
        const savedTheme = localStorage.getItem("theme") || "dark";
        document.documentElement.setAttribute("data-theme", savedTheme);
        updateThemeIcon(savedTheme);
        
        setupNavigation();
        setupEventListeners();
        
        // Initial load
        refreshGlobalStatus();
        loadAllData();
        
        // Start logs & status polling
        setupPolling();
    }

    function updateThemeIcon(theme) {
        const icon = document.getElementById("theme-icon");
        if (!icon) return;
        if (theme === "light") {
            icon.className = "fa-solid fa-moon";
        } else {
            icon.className = "fa-solid fa-sun";
        }
    }

    function setupNavigation() {
        const navButtons = document.querySelectorAll(".nav-btn");
        const sections = document.querySelectorAll(".view-section");
        const viewTitle = document.getElementById("current-view-title");

        navButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const view = btn.dataset.view;
                
                // Toggle active class on sidebar
                navButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                // Toggle views visibility
                sections.forEach(sec => sec.classList.add("hidden"));
                document.getElementById(`view-${view}`).classList.remove("hidden");

                // Update Header Title
                const titles = {
                    dashboard: "Tableau de bord",
                    transactions: "Transactions",
                    budgets: "Budgets & Catégories",
                    epargne: "Épargne",
                    credits: "Crédits",
                    synthesis: "Synthèse Annuelle",
                    config: "Configuration & Outils"
                };
                viewTitle.textContent = titles[view] || "CompteApp";

                state.currentView = view;
                
                // Refresh data for the specific view
                onViewChanged(view);
            });
        });
    }

    function onViewChanged(view) {
        if (view === "dashboard") {
            loadDashboardData();
        } else if (view === "transactions") {
            loadTransactionsData();
        } else if (view === "budgets") {
            loadBudgetsData();
        } else if (view === "epargne") {
            loadEpargneData();
        } else if (view === "credits") {
            loadCreditsData();
        } else if (view === "synthesis") {
            loadSynthesisData();
        } else if (view === "config") {
            loadConfigData();
        }
    }

    function setupEventListeners() {
        // Theme Toggle
        const btnToggleTheme = document.getElementById("btn-toggle-theme");
        if (btnToggleTheme) {
            btnToggleTheme.addEventListener("click", () => {
                const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
                const newTheme = currentTheme === "dark" ? "light" : "dark";
                document.documentElement.setAttribute("data-theme", newTheme);
                localStorage.setItem("theme", newTheme);
                updateThemeIcon(newTheme);
                if (state.currentView === "dashboard") {
                    loadDashboardData();
                }
            });
        }

        // Sync Buttons
        document.getElementById("btn-sync-now").addEventListener("click", triggerSync);
        document.getElementById("btn-update-woob").addEventListener("click", triggerWoobUpdate);
        
        // General Settings Form
        document.getElementById("form-settings").addEventListener("submit", saveGeneralSettings);
        
        // Monthly Savings Rates Save Button
        const btnSaveMonthlyRates = document.getElementById("btn-save-monthly-rates");
        if (btnSaveMonthlyRates) {
            btnSaveMonthlyRates.addEventListener("click", saveMonthlySavingsRates);
        }

        // Loans Event Listeners
        const btnToggleEditLoan = document.getElementById("btn-toggle-edit-loan");
        if (btnToggleEditLoan) {
            btnToggleEditLoan.addEventListener("click", () => {
                const container = document.getElementById("loan-edit-form-container");
                if (container) container.classList.toggle("hidden");
            });
        }

        const btnAddLoanManual = document.getElementById("btn-add-loan-manual");
        if (btnAddLoanManual) {
            btnAddLoanManual.addEventListener("click", () => {
                selectedLoanKey = "new_manual";
                
                document.getElementById("loan-detail-title").innerHTML = `<i class="fa-solid fa-plus"></i> Nouveau Prêt Manuel`;
                
                const formContainer = document.getElementById("loan-edit-form-container");
                if (formContainer) formContainer.classList.remove("hidden");
                
                document.getElementById("loan-info-card").innerHTML = `
                    <p class="text-muted" style="text-align: center; padding: 20px;">Saisissez les paramètres de votre nouveau prêt ci-dessous.</p>
                `;
                document.getElementById("loan-schedule-panel").classList.add("hidden");
                
                const form = document.getElementById("form-loan-config");
                if (form) {
                    form.reset();
                    document.getElementById("loan-config-id").value = "";
                }
                const btnDelete = document.getElementById("btn-delete-loan");
                if (btnDelete) btnDelete.style.display = "none";
            });
        }

        const formLoanConfig = document.getElementById("form-loan-config");
        if (formLoanConfig) {
            formLoanConfig.addEventListener("submit", async (e) => {
                e.preventDefault();
                
                const idVal = document.getElementById("loan-config-id").value;
                const payload = {
                    name: document.getElementById("loan-config-name").value.trim(),
                    amount: parseFloat(document.getElementById("loan-config-amount").value),
                    rate: parseFloat(document.getElementById("loan-config-rate").value),
                    duration_months: parseInt(document.getElementById("loan-config-duration").value),
                    start_date: document.getElementById("loan-config-start-date").value,
                    monthly_payment: parseFloat(document.getElementById("loan-config-payment").value),
                    insurance: parseFloat(document.getElementById("loan-config-insurance").value) || 0.0,
                    account_id: document.getElementById("loan-config-account-id").value || null,
                    id: idVal ? parseInt(idVal) : null
                };
                
                try {
                    const res = await fetch("/api/loans", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    
                    if (res.ok) {
                        showToast("Crédit enregistré avec succès.", "success");
                        await loadCreditsData();
                    } else {
                        const data = await res.json();
                        showToast(data.detail || "Erreur lors de l'enregistrement.", "error");
                    }
                } catch (err) {
                    showToast("Erreur réseau.", "error");
                }
            });
        }

        const btnDeleteLoan = document.getElementById("btn-delete-loan");
        if (btnDeleteLoan) {
            btnDeleteLoan.addEventListener("click", async () => {
                const idVal = document.getElementById("loan-config-id").value;
                if (!idVal) return;
                
                if (!confirm("Voulez-vous vraiment supprimer ce prêt ? Cette opération est irréversible.")) return;
                
                try {
                    const res = await fetch(`/api/loans/${idVal}`, {
                        method: "DELETE"
                    });
                    
                    if (res.ok) {
                        showToast("Crédit supprimé.", "success");
                        selectedLoanKey = null;
                        await loadCreditsData();
                    } else {
                        showToast("Erreur lors de la suppression.", "error");
                    }
                } catch (err) {
                    showToast("Erreur réseau.", "error");
                }
            });
        }
        
        // Bank Connections add/cancel
        document.getElementById("btn-add-account").addEventListener("click", showAddBankForm);
        document.getElementById("btn-cancel-bank").addEventListener("click", hideBankForm);
        document.getElementById("form-bank").addEventListener("submit", saveBankConfig);
        document.getElementById("bank_module").addEventListener("change", handleBankModuleChange);

        // Transaction filters
        document.getElementById("tx-filter-search").addEventListener("input", debounce(() => {
            state.txFilters.search = document.getElementById("tx-filter-search").value;
            state.txOffset = 0;
            loadTransactionsData();
        }, 300));
        document.getElementById("tx-filter-account").addEventListener("change", () => {
            state.txFilters.account_id = document.getElementById("tx-filter-account").value;
            state.txOffset = 0;
            loadTransactionsData();
        });
        document.getElementById("tx-filter-category").addEventListener("change", () => {
            state.txFilters.category = document.getElementById("tx-filter-category").value;
            state.txOffset = 0;
            loadTransactionsData();
        });
        document.getElementById("tx-filter-type").addEventListener("change", () => {
            state.txFilters.type = document.getElementById("tx-filter-type").value;
            state.txOffset = 0;
            loadTransactionsData();
        });
        document.getElementById("tx-filter-month").addEventListener("change", () => {
            const val = document.getElementById("tx-filter-month").value;
            state.txFilters.month = val;
            if (val) {
                const [y, m] = val.split("-");
                const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
                state.txFilters.date_from = `${y}-${m}-01`;
                state.txFilters.date_to = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
            } else {
                state.txFilters.date_from = "";
                state.txFilters.date_to = "";
            }
            state.txOffset = 0;
            loadTransactionsData();
        });

        // Synthesis filters
        const yearSelect = document.getElementById("synthesis-year-select");
        if (yearSelect) {
            yearSelect.addEventListener("change", (e) => {
                state.year = parseInt(e.target.value);
                
                // Reset selected month to January of the new year or current month if it's the current calendar year
                const now = new Date();
                if (state.year === now.getFullYear()) {
                    state.selectedMonth = `${state.year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                } else {
                    state.selectedMonth = `${state.year}-01`;
                }
                loadAllData();
            });
        }
        document.querySelectorAll('input[name="synthesis-mode"]').forEach(radio => {
            radio.addEventListener("change", () => {
                loadSynthesisData();
            });
        });

        // Transactions Pagination
        document.getElementById("btn-page-prev").addEventListener("click", () => {
            if (state.txOffset > 0) {
                state.txOffset -= state.txLimit;
                loadTransactionsData();
            }
        });
        document.getElementById("btn-page-next").addEventListener("click", () => {
            if (state.txOffset + state.txLimit < state.totalTransactions) {
                state.txOffset += state.txLimit;
                loadTransactionsData();
            }
        });

        // Rules add/cancel
        document.getElementById("btn-add-rule").addEventListener("click", () => {
            document.getElementById("rule-form-container").classList.toggle("hidden");
        });
        document.getElementById("btn-cancel-rule").addEventListener("click", () => {
            document.getElementById("rule-form-container").classList.add("hidden");
            document.getElementById("form-rule").reset();
        });
        document.getElementById("form-rule").addEventListener("submit", saveAutoRule);

        // Budget Limit Form
        document.getElementById("form-edit-budget").addEventListener("submit", saveBudgetLimit);
        document.getElementById("btn-close-budget-modal").addEventListener("click", () => {
            document.getElementById("modal-budget").classList.add("hidden");
        });
        
        // Add Category Modal
        const btnAddCat = document.getElementById("btn-add-category");
        if (btnAddCat) {
            btnAddCat.addEventListener("click", () => {
                document.getElementById("modal-add-category").classList.remove("hidden");
                document.getElementById("add-cat-name").focus();
            });
        }
        
        const btnCloseAddCatModal = document.getElementById("btn-close-add-cat-modal");
        if (btnCloseAddCatModal) {
            btnCloseAddCatModal.addEventListener("click", () => {
                document.getElementById("modal-add-category").classList.add("hidden");
                document.getElementById("form-add-category").reset();
            });
        }
        
        const btnCancelAddCat = document.getElementById("btn-cancel-add-cat");
        if (btnCancelAddCat) {
            btnCancelAddCat.addEventListener("click", () => {
                document.getElementById("modal-add-category").classList.add("hidden");
                document.getElementById("form-add-category").reset();
            });
        }
        
        // Add Manual Transaction Modal Event Listeners
        const btnOpenAddTx = document.getElementById("btn-add-transaction");
        if (btnOpenAddTx) {
            btnOpenAddTx.addEventListener("click", () => {
                openAddTransactionModal();
            });
        }

        const btnCloseAddTxModal = document.getElementById("btn-close-add-tx-modal");
        if (btnCloseAddTxModal) {
            btnCloseAddTxModal.addEventListener("click", () => {
                document.getElementById("modal-add-transaction").classList.add("hidden");
                document.getElementById("form-add-transaction").reset();
            });
        }

        const btnCloseAddTxX = document.getElementById("btn-close-add-tx-x");
        if (btnCloseAddTxX) {
            btnCloseAddTxX.addEventListener("click", () => {
                document.getElementById("modal-add-transaction").classList.add("hidden");
                document.getElementById("form-add-transaction").reset();
            });
        }

        const formAddTx = document.getElementById("form-add-transaction");
        if (formAddTx) {
            formAddTx.addEventListener("submit", handleAddTransactionSubmit);
        }

        const addTxFlowType = document.getElementById("add-tx-flow-type");
        if (addTxFlowType) {
            addTxFlowType.addEventListener("change", () => {
                updateAddTransactionCategories();
            });
        }

        // Import Modal Event Listeners
        const btnOpenImport = document.getElementById("btn-open-import");
        if (btnOpenImport) {
            btnOpenImport.addEventListener("click", () => {
                populateImportAccountsSelector();
                document.getElementById("modal-import").classList.remove("hidden");
            });
        }

        const btnCloseImport = document.getElementById("btn-close-import-modal");
        if (btnCloseImport) {
            btnCloseImport.addEventListener("click", () => {
                document.getElementById("modal-import").classList.add("hidden");
                document.getElementById("form-import-transactions").reset();
            });
        }

        const formImport = document.getElementById("form-import-transactions");
        if (formImport) {
            formImport.addEventListener("submit", handleImportSubmit);
        }

        const importAccountSelect = document.getElementById("import-account-id");
        if (importAccountSelect) {
            importAccountSelect.addEventListener("change", (e) => {
                const newAccFields = document.getElementById("import-new-account-fields");
                if (e.target.value === "__new_manual__") {
                    newAccFields.classList.remove("hidden");
                    document.getElementById("import-new-account-id").required = true;
                    document.getElementById("import-new-account-label").required = true;
                } else {
                    newAccFields.classList.add("hidden");
                    document.getElementById("import-new-account-id").required = false;
                    document.getElementById("import-new-account-label").required = false;
                }
            });
        }
        
        // Split Modal Event Listeners
        const btnCloseSplit = document.getElementById("btn-close-split-modal");
        if (btnCloseSplit) {
            btnCloseSplit.addEventListener("click", () => {
                document.getElementById("modal-split-transaction").classList.add("hidden");
            });
        }
        
        const btnAddSplitPart = document.getElementById("btn-add-split-part");
        if (btnAddSplitPart) {
            btnAddSplitPart.addEventListener("click", () => {
                addSplitPartRow();
            });
        }
        
        const formSplit = document.getElementById("form-split-transaction");
        if (formSplit) {
            formSplit.addEventListener("submit", handleSplitSubmit);
        }
        
        const formAddCat = document.getElementById("form-add-category");
        if (formAddCat) {
            formAddCat.addEventListener("submit", saveNewCategory);
        }

        // Savings Rates Form
        document.getElementById("form-savings-rates").addEventListener("submit", saveSavingsRates);

        // Logs Clear
        document.getElementById("btn-clear-logs").addEventListener("click", clearLogsHistory);

        // Synthesis Table Inline Editing
        const tableSynthesis = document.getElementById("table-synthesis");
        if (tableSynthesis) {
            tableSynthesis.addEventListener("click", (e) => {
                const cell = e.target.closest("td.editable-cell");
                if (!cell || cell.querySelector("input")) return;
                
                const category = cell.dataset.category;
                const month = cell.dataset.month;
                const rawVal = parseFloat(cell.dataset.value || "0");
                
                const input = document.createElement("input");
                input.type = "number";
                input.step = "0.01";
                input.value = rawVal;
                input.className = "inline-edit-input";
                
                // Style input to fit neatly
                input.style.width = (cell.offsetWidth - 20) + "px";
                input.style.textAlign = "right";
                
                cell.innerHTML = "";
                cell.appendChild(input);
                input.focus();
                input.select();
                
                let finished = false;
                
                async function finishEdit(save) {
                    if (finished) return;
                    finished = true;
                    
                    if (save) {
                        const newVal = parseFloat(input.value);
                        if (!isNaN(newVal) && newVal >= 0) {
                            try {
                                const res = await fetch("/api/monthly-budgets", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        category_name: category,
                                        month: month,
                                        budget: newVal
                                    })
                                });
                                const resData = await res.json();
                                if (resData.status === "success") {
                                    showToast("Budget mis à jour.", "success");
                                    // Trigger reload of data
                                    await loadAllData();
                                } else {
                                    showToast("Erreur lors de la mise à jour.", "error");
                                    cell.textContent = formatCurrency(rawVal);
                                    loadSynthesisData();
                                }
                            } catch (err) {
                                showToast("Erreur de connexion.", "error");
                                cell.textContent = formatCurrency(rawVal);
                                loadSynthesisData();
                            }
                        } else {
                            showToast("Valeur invalide.", "error");
                            cell.textContent = formatCurrency(rawVal);
                            loadSynthesisData();
                        }
                    } else {
                        cell.textContent = formatCurrency(rawVal);
                        loadSynthesisData();
                    }
                }
                
                input.addEventListener("blur", () => finishEdit(true));
                input.addEventListener("keydown", (evt) => {
                    if (evt.key === "Enter") {
                        finishEdit(true);
                    } else if (evt.key === "Escape") {
                        finishEdit(false);
                    }
                });
            });
        }
    }

    // -------------------------------------------------------------
    // DATA FETCHING & SYNCHRONIZATION
    // -------------------------------------------------------------
    async function loadAllData() {
        try {
            const statsRes = await fetch(`/api/stats?year=${state.year}`);
            const data = await statsRes.json();
            
            state.accounts = data.accounts;
            state.categories = data.categories;
            
            // Set default selected month to current calendar month or latest month with data, only if not already matching the active year
            if (!state.selectedMonth || !state.selectedMonth.startsWith(`${state.year}-`)) {
                const months = Object.keys(data.monthly_data).sort();
                const nowMonth = `${state.year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
                state.selectedMonth = months.includes(nowMonth) ? nowMonth : (months[months.length - 1] || nowMonth);
            }
            
            // Populate filters and month selector
            populateSelectors(data);
            
            // Load current view
            onViewChanged(state.currentView);
        } catch (err) {
            showToast("Erreur lors de la récupération globale des données.", "error");
        }
    }

    async function loadDashboardData() {
        try {
            const statsRes = await fetch(`/api/stats?year=${state.year}`);
            const data = await statsRes.json();
            
            state.accounts = data.accounts;
            state.categories = data.categories;
            
            // Compute KPIs
            // 1. Patrimoine Net (courant + livret + investissement - pret) and Patrimoine Positif (actifs seuls)
            let netWorth = 0;
            let positiveWealth = 0;
            data.accounts.forEach(acc => {
                if (acc.include_in_budget_and_list === 0) return; // Skip excluded accounts
                
                if (acc.type === "pret") {
                    netWorth -= Math.abs(acc.balance); // Loan reduces net worth (ensure it's subtracted)
                } else {
                    netWorth += acc.balance;
                    positiveWealth += acc.balance; // Add to positive assets
                }
            });
            document.getElementById("stat-patrimoine-net").textContent = formatCurrency(netWorth);
            document.getElementById("stat-patrimoine-net").className = netWorth >= 0 ? "green-text" : "red-text";
            
            document.getElementById("stat-patrimoine-positif").textContent = formatCurrency(positiveWealth);
            document.getElementById("stat-patrimoine-positif").className = "green-text";

            // 2. Income / Expense for selected month
            const monthData = data.monthly_data[state.selectedMonth] || { income: 0, fixed: 0, variable: 0, savings: 0 };
            const monthlyIncome = monthData.income;
            const monthlyExpenses = monthData.fixed + monthData.variable;
            const monthlySavings = monthlyIncome - monthlyExpenses;

            document.getElementById("stat-revenus-mois").textContent = formatCurrency(monthlyIncome);
            document.getElementById("stat-depenses-mois").textContent = formatCurrency(monthlyExpenses);
            
            // Savings rate = (income - expenses) / income * 100
            let savingsRate = 0;
            if (monthlyIncome > 0) {
                savingsRate = Math.round((monthlySavings / monthlyIncome) * 100);
            }
            document.getElementById("stat-taux-epargne").textContent = `${savingsRate} %`;
            
            // Display Reste à vivre in subtext of Taux d'Épargne card
            const rateLabelEl = document.querySelector("#stat-taux-epargne + p");
            if (rateLabelEl) {
                const prefix = monthlySavings >= 0 ? "+" : "";
                rateLabelEl.innerHTML = `Taux d'Épargne<br><span style="font-size:0.75rem; opacity:0.8; font-weight:bold; color: ${monthlySavings >= 0 ? '#0ebc7f' : '#ff4a6b'};">Reste à vivre : ${prefix}${formatCurrency(monthlySavings)}</span>`;
            }

            // Render accounts table
            renderDashboardAccounts(data.accounts);

            // Render Charts
            renderDashboardCharts(data);
        } catch (err) {
            console.error("Dashboard error:", err);
            showToast("Erreur lors du chargement des statistiques.", "error");
        }
    }

    function renderDashboardAccounts(accounts) {
        const tbody = document.querySelector("#table-accounts-dashboard tbody");
        
        const activeAccounts = accounts.filter(acc => acc.include_in_budget_and_list !== 0);
        
        if (activeAccounts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center">Aucun compte bancaire actif.</td></tr>`;
            return;
        }

        tbody.innerHTML = activeAccounts.map(acc => {
            const syncTime = acc.last_sync ? new Date(acc.last_sync).toLocaleString("fr-FR", { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : "Jamais";
            const typeLabels = {
                courant: "Courant",
                livret: "Épargne",
                investissement: "Titres / PEA",
                pret: "Crédit",
                autre: "Autre"
            };
            const typeLabel = typeLabels[acc.type] || acc.type;
            const balanceClass = acc.type === "pret" ? "red-text" : (acc.balance >= 0 ? "green-text" : "red-text");
            const prefix = acc.type === "pret" ? "-" : "";

            return `
                <tr>
                    <td><strong>${escapeHTML(acc.label.split(" - ").slice(1).join(" - ") || acc.label)}</strong></td>
                    <td><span class="badge badge-muted">${escapeHTML(acc.backend_name)}</span></td>
                    <td>${typeLabel}</td>
                    <td class="text-muted">${syncTime}</td>
                    <td class="text-right ${balanceClass}"><strong>${prefix}${formatCurrency(acc.balance)}</strong></td>
                </tr>
            `;
        }).join("");
    }

    function renderDashboardCharts(data) {
        const months = Object.keys(data.monthly_data).sort();
        
        // Resolve theme colors dynamically
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || "#8b95a5";
        const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border-glass').trim() || "rgba(255,255,255,0.05)";
        const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || "rgba(13,17,28,0.8)";

        // --- 1. Flux chart ---
        const ctxFlux = document.getElementById("chart-flux").getContext("2d");
        const datasetIncome = [];
        const datasetExpenses = [];
        const datasetSavings = [];
        
        const incomeColors = [];
        const expensesColors = [];
        const savingsColors = [];

        let cumulativeSavingsVal = 0;
        const datasetCumulativeSavings = [];
        
        const now = new Date();
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        
        const isFutureMonth = (m) => {
            const [y, mn] = m.split("-").map(Number);
            if (y > curY) return true;
            if (y < curY) return false;
            return mn > curM;
        };

        months.forEach(m => {
            const mData = data.monthly_data[m];
            
            // Calculate budget sums for this month
            let incBudget = 0;
            let expBudget = 0;
            data.categories.forEach(cat => {
                const budgetVal = mData.budgets[cat.name] || 0;
                if (cat.type === "Revenu") {
                    incBudget += budgetVal;
                } else if (cat.type === "Dépense fixe" || cat.type === "Dépense variable") {
                    expBudget += budgetVal;
                }
            });
            const savBudget = incBudget - expBudget;

            let incVal, expVal, savVal;
            const isProj = isFutureMonth(m);

            if (isProj) {
                incVal = incBudget;
                expVal = expBudget;
                savVal = savBudget;
                
                // 45% opacity for projected months
                incomeColors.push("rgba(14, 188, 127, 0.45)");
                expensesColors.push("rgba(255, 74, 107, 0.45)");
                savingsColors.push("rgba(14, 186, 247, 0.45)");
            } else {
                incVal = mData.income;
                expVal = mData.fixed + mData.variable;
                savVal = mData.income - (mData.fixed + mData.variable);
                
                // Solid colors for past/current months
                incomeColors.push("#0ebc7f");
                expensesColors.push("#ff4a6b");
                savingsColors.push("#0ebaf7");
            }

            datasetIncome.push(incVal);
            datasetExpenses.push(expVal);
            datasetSavings.push(savVal);
            
            cumulativeSavingsVal += savVal;
            datasetCumulativeSavings.push(cumulativeSavingsVal);
        });

        const monthLabelsFr = months.map(m => {
            const [y, mn] = m.split("-");
            const date = new Date(y, parseInt(mn) - 1, 1);
            return date.toLocaleString("fr-FR", { month: "short", year: "2-digit" });
        });

        if (state.charts.flux) {
            state.charts.flux.destroy();
        }

        state.charts.flux = new Chart(ctxFlux, {
            data: {
                labels: monthLabelsFr,
                datasets: [
                    // --- CUMULATIVE SAVINGS (Line on Y-right) ---
                    {
                        type: "line",
                        label: "Épargne Cumulée",
                        data: datasetCumulativeSavings,
                        borderColor: "#905cf7",
                        borderWidth: 3,
                        pointBackgroundColor: "#905cf7",
                        pointBorderColor: "#ffffff",
                        pointBorderWidth: 1.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        fill: false,
                        tension: 0.3,
                        yAxisID: "ySavings",
                        order: 1
                    },
                    // --- REALISE (Bars on Y-left) ---
                    {
                        type: "bar",
                        label: "Revenus",
                        data: datasetIncome,
                        backgroundColor: incomeColors,
                        borderRadius: 5,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8,
                        yAxisID: "y",
                        order: 2
                    },
                    {
                        type: "bar",
                        label: "Dépenses",
                        data: datasetExpenses,
                        backgroundColor: expensesColors,
                        borderRadius: 5,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8,
                        yAxisID: "y",
                        order: 2
                    },
                    {
                        type: "bar",
                        label: "Épargne",
                        data: datasetSavings,
                        backgroundColor: savingsColors,
                        borderRadius: 5,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8,
                        yAxisID: "y",
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: textColor,
                            font: { family: "Outfit" }
                        }
                    },
                    tooltip: {
                        mode: "index",
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    const m = months[context.dataIndex];
                                    if (isFutureMonth(m)) {
                                        label += " (Prévu)";
                                    }
                                    label += ": ";
                                }
                                if (context.parsed.y !== null) {
                                    label += formatCurrency(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: textColor }, grid: { display: false } },
                    y: {
                        position: "left",
                        ticks: { color: textColor },
                        grid: { color: gridColor },
                        title: { display: true, text: "Flux Mensuels (€)", color: textColor, font: { family: "Outfit", weight: "bold" } }
                    },
                    ySavings: {
                        position: "right",
                        ticks: { color: textColor },
                        grid: { display: false },
                        title: { display: true, text: "Épargne Cumulée (€)", color: textColor, font: { family: "Outfit", weight: "bold" } }
                    }
                }
            }
        });

        // --- 2. Categories chart ---
        const ctxCat = document.getElementById("chart-categories").getContext("2d");
        const monthData = data.monthly_data[state.selectedMonth] || { details: {} };
        
        // Group by category, sorting descending
        const catArray = [];
        for (const [catName, amount] of Object.entries(monthData.details)) {
            // Find category type to filter only expenses (fixed + variable)
            const catInfo = state.categories.find(c => c.name === catName);
            if (catInfo && (catInfo.type === "Dépense fixe" || catInfo.type === "Dépense variable")) {
                catArray.push({ name: catName, value: amount });
            }
        }
        catArray.sort((a, b) => b.value - a.value);

        // Take top 6 and group others
        const labels = [];
        const values = [];
        let otherSum = 0;

        catArray.forEach((item, index) => {
            if (index < 6) {
                labels.push(item.name);
                values.push(item.value);
            } else {
                otherSum += item.value;
            }
        });

        if (otherSum > 0) {
            labels.push("Autres dépenses");
            values.push(otherSum);
        }

        if (state.charts.categories) {
            state.charts.categories.destroy();
        }

        if (labels.length === 0) {
            // Empty state helper for chart
            labels.push("Aucune dépense");
            values.push(1);
        }

        const chartColors = ["#ff4a6b", "#905cf7", "#fca822", "#0ebaf7", "#ec4899", "#84cc16", "#64748b"];

        state.charts.categories = new Chart(ctxCat, {
            type: "doughnut",
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: chartColors,
                    borderWidth: 1,
                    borderColor: cardBg
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: textColor, boxWidth: 12, font: { family: "Outfit", size: 11 } }
                    }
                },
                cutout: "65%"
            }
        });
    }

    // -------------------------------------------------------------
    // TRANSACTIONS LOGIC
    // -------------------------------------------------------------
    async function loadTransactionsData() {
        try {
            // Construct query parameters
            let url = `/api/transactions?limit=${state.txLimit}&offset=${state.txOffset}`;
            if (state.txFilters.search) url += `&search=${encodeURIComponent(state.txFilters.search)}`;
            if (state.txFilters.account_id) url += `&account_id=${encodeURIComponent(state.txFilters.account_id)}`;
            if (state.txFilters.category) url += `&category=${encodeURIComponent(state.txFilters.category)}`;
            if (state.txFilters.type) url += `&tr_type=${encodeURIComponent(state.txFilters.type)}`;
            if (state.txFilters.date_from) url += `&date_from=${encodeURIComponent(state.txFilters.date_from)}`;
            if (state.txFilters.date_to) url += `&date_to=${encodeURIComponent(state.txFilters.date_to)}`;
            
            const res = await fetch(url);
            const data = await res.json();
            
            state.transactions = data.transactions;
            state.totalTransactions = data.total;
            
            renderTransactionsList(data.transactions);
            updatePaginationUI();
        } catch (err) {
            showToast("Erreur lors de la lecture des transactions.", "error");
        }
    }

    function renderTransactionsList(transactions) {
        const tbody = document.querySelector("#table-transactions tbody");
        if (transactions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Aucune transaction trouvée pour ces filtres.</td></tr>`;
            return;
        }

        // Sort categories alphabetically
        const sortedCategories = [...state.categories].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

        tbody.innerHTML = transactions.map(t => {
            const amountClass = t.amount >= 0 ? "green-text" : "red-text";
            const amountText = (t.amount >= 0 ? "+" : "") + formatCurrency(t.amount);
            
            // Clean account label
            const shortAccountLabel = t.account_label ? (t.account_label.split(" - ").slice(1).join(" - ") || t.account_label) : "";

            // Filter categories based on transaction type (income vs expense)
            const filteredCategories = sortedCategories.filter(c => {
                // Always keep the currently selected category so it's visible even if mismatched
                if (t.category && c.name === t.category) {
                    return true;
                }
                // Always keep Transfert categories for both incomes and expenses
                if (c.type === "Transfert" || c.name.toLowerCase() === "transfert") {
                    return true;
                }
                if (t.amount >= 0) {
                    return c.type === "Revenu";
                } else {
                    return c.type === "Dépense fixe" || c.type === "Dépense variable";
                }
            });

            const categoryOptionsHtml = filteredCategories.map(c => 
                `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)} (${escapeHTML(c.type)})</option>`
            ).join("");

            return `
                <tr data-id="${t.id}">
                    <td class="text-muted">${escapeHTML(t.date)}</td>
                    <td><strong>${escapeHTML(t.label)}</strong></td>
                    <td><span class="badge badge-muted" title="${escapeHTML(t.account_label)}">${escapeHTML(shortAccountLabel)}</span></td>
                    <td>
                        <select class="table-select transaction-category-select">
                            <option value="">-- Choisir une catégorie --</option>
                            ${categoryOptionsHtml}
                        </select>
                    </td>
                    <td>
                        <input type="text" class="table-input-note transaction-note-input" value="${escapeHTML(t.note || '')}" placeholder="Ajouter une note...">
                    </td>
                    <td class="text-center">
                        <input type="checkbox" class="table-checkbox transaction-checked-cb" ${t.checked ? "checked" : ""}>
                    </td>
                    <td class="text-center">
                        <input type="checkbox" class="table-checkbox transaction-decalage-cb" ${t.decalage ? "checked" : ""}>
                    </td>
                    <td class="text-right ${amountClass}"><strong>${amountText}</strong></td>
                    <td class="text-center" style="white-space: nowrap;">
                        <button class="btn btn-secondary btn-sm btn-split-tx" title="Scinder la transaction" style="padding: 2px 6px; font-size: 0.8rem;">
                            <i class="fa-solid fa-scissors"></i>
                        </button>
                        <button class="btn btn-danger btn-sm btn-delete-tx" title="Supprimer la transaction" style="padding: 2px 6px; font-size: 0.8rem; margin-left: 4px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        // Set values and bind events for inline controls
        tbody.querySelectorAll("tr").forEach(row => {
            const tId = row.dataset.id;
            const t = transactions.find(item => item.id === tId);
            
            // Category select
            const catSelect = row.querySelector(".transaction-category-select");
            catSelect.value = t.category || "";
            catSelect.addEventListener("change", async () => {
                await updateTransactionInline(tId, { category: catSelect.value });
            });

            // Note input
            const noteInput = row.querySelector(".transaction-note-input");
            noteInput.addEventListener("change", async () => {
                await updateTransactionInline(tId, { note: noteInput.value });
            });

            // Checked (Pt) checkbox
            const checkedCb = row.querySelector(".transaction-checked-cb");
            checkedCb.addEventListener("change", async () => {
                await updateTransactionInline(tId, { checked: checkedCb.checked });
            });

            // Decalage (Déc) checkbox
            const decalageCb = row.querySelector(".transaction-decalage-cb");
            decalageCb.addEventListener("change", async () => {
                await updateTransactionInline(tId, { decalage: decalageCb.checked });
            });

            // Split button click
            const btnSplit = row.querySelector(".btn-split-tx");
            if (btnSplit) {
                btnSplit.addEventListener("click", () => {
                    openSplitModal(t);
                });
            }

            // Delete button click
            const btnDelete = row.querySelector(".btn-delete-tx");
            if (btnDelete) {
                btnDelete.addEventListener("click", () => {
                    deleteTransaction(tId);
                });
            }
        });
    }

    async function updateTransactionInline(tId, payload) {
        try {
            const res = await fetch(`/api/transactions/${tId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                // If decalage or category changed, we need to refresh statistics since charts depend on them!
                if (payload.decalage !== undefined || payload.category !== undefined) {
                    showToast("Transaction mise à jour et statistiques recalculées.", "success");
                    loadAllData(); // Refresh state & charts
                }
            } else {
                showToast("Erreur lors de la mise à jour de la transaction.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    function updatePaginationUI() {
        const page = Math.floor(state.txOffset / state.txLimit) + 1;
        const maxPage = Math.max(1, Math.ceil(state.totalTransactions / state.txLimit));
        document.getElementById("page-indicator").textContent = `Page ${page} sur ${maxPage} (${state.totalTransactions} transactions)`;
        
        document.getElementById("btn-page-prev").disabled = state.txOffset === 0;
        document.getElementById("btn-page-next").disabled = state.txOffset + state.txLimit >= state.totalTransactions;
    }

    // -------------------------------------------------------------
    // BUDGETS & MONTHS SELECTORS
    // -------------------------------------------------------------
    function populateSelectors(data) {
        // Year Selector on Synthesis Page
        const synthesisYearSelect = document.getElementById("synthesis-year-select");
        if (synthesisYearSelect) {
            const years = data.available_years || [new Date().getFullYear()];
            
            synthesisYearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
            
            if (years.map(String).includes(state.year.toString())) {
                synthesisYearSelect.value = state.year.toString();
            } else {
                synthesisYearSelect.value = years[0];
                state.year = parseInt(years[0]);
            }
        }

        // Month Selector on Budget Page
        const monthSelect = document.getElementById("budget-month-select");
        const txMonthSelect = document.getElementById("tx-filter-month");
        const years = data.available_years || [new Date().getFullYear()];
        const months = [];
        years.forEach(y => {
            for (let m = 12; m >= 1; m--) {
                months.push(`${y}-${String(m).padStart(2, '0')}`);
            }
        });
        
        const monthOptionsHtml = months.map(m => {
            const [y, mn] = m.split("-");
            const date = new Date(y, parseInt(mn) - 1, 1);
            const label = date.toLocaleString("fr-FR", { month: "long", year: "numeric" });
            return `<option value="${m}">${label}</option>`;
        }).join("");

        monthSelect.innerHTML = monthOptionsHtml;
        
        if (months.includes(state.selectedMonth)) {
            monthSelect.value = state.selectedMonth;
        } else if (months.length > 0) {
            monthSelect.value = months[0];
            state.selectedMonth = months[0];
        }

        monthSelect.onchange = () => {
            const selectedM = monthSelect.value;
            const selectedY = parseInt(selectedM.split("-")[0]);
            
            if (selectedY !== state.year) {
                state.year = selectedY;
                state.selectedMonth = selectedM;
                loadAllData();
            } else {
                state.selectedMonth = selectedM;
                loadBudgetsData();
            }
        };

        if (txMonthSelect) {
            txMonthSelect.innerHTML = `<option value="">Tous les mois</option>` + monthOptionsHtml;
            if (state.txFilters.month) {
                txMonthSelect.value = state.txFilters.month;
            } else {
                txMonthSelect.value = "";
            }
        }

        // Filter selectors on Transaction Page
        const accountFilter = document.getElementById("tx-filter-account");
        accountFilter.innerHTML = `<option value="">Tous les comptes</option>` + state.accounts.map(acc => 
            `<option value="${acc.id}">${escapeHTML(acc.label.split(" - ").slice(1).join(" - ") || acc.label)}</option>`
        ).join("");

        const catFilter = document.getElementById("tx-filter-category");
        catFilter.innerHTML = `<option value="">Toutes les catégories</option>` + state.categories.map(c => 
            `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`
        ).join("");

        // Category options inside rule forms
        const ruleCatSelect = document.getElementById("rule_category");
        ruleCatSelect.innerHTML = `<option value="" disabled selected>Choisir...</option>` + state.categories.map(c => 
            `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)} (${c.type})</option>`
        ).join("");
    }

    async function loadBudgetsData() {
        try {
            const statsRes = await fetch(`/api/stats?year=${state.year}`);
            const data = await statsRes.json();
            
            const monthData = data.monthly_data[state.selectedMonth] || { income: 0, fixed: 0, variable: 0, savings: 0, details: {} };
            
            // 1. Render Summary Header
            const netVal = monthData.income - monthData.fixed - monthData.variable;
            document.getElementById("budget-summary-income").textContent = formatCurrency(monthData.income);
            document.getElementById("budget-summary-fixed").textContent = formatCurrency(monthData.fixed);
            document.getElementById("budget-summary-variable").textContent = formatCurrency(monthData.variable);
            document.getElementById("budget-summary-savings").textContent = formatCurrency(monthData.savings);
            document.getElementById("budget-summary-net").textContent = formatCurrency(netVal);
            document.getElementById("budget-summary-net").className = `value ${netVal >= 0 ? "green-text" : "red-text"}`;

            // 2. Render Cards per type
            renderBudgetCategoryList(data, "Dépense fixe", "budget-list-fixed", monthData.details);
            renderBudgetCategoryList(data, "Dépense variable", "budget-list-variable", monthData.details);
            renderBudgetCategoryList(data, "Revenu", "budget-list-income", monthData.details);
        } catch (err) {
            showToast("Erreur lors de la lecture des budgets.", "error");
        }
    }

    function renderBudgetCategoryList(data, type, elementId, actualsDetails) {
        const container = document.getElementById(elementId);
        // Filter categories of this type
        const cats = data.categories.filter(c => c.type === type);
        
        if (cats.length === 0) {
            container.innerHTML = `<p class="text-muted text-center">Aucune catégorie.</p>`;
            return;
        }

        container.innerHTML = cats.map(cat => {
            const actual = actualsDetails[cat.name] || 0.0;
            const selectedMonthData = data.monthly_data[state.selectedMonth] || { budgets: {} };
            const budget = (selectedMonthData.budgets && selectedMonthData.budgets[cat.name] !== undefined)
                           ? selectedMonthData.budgets[cat.name]
                           : cat.monthly_budget;
            
            let percentage = 0;
            if (budget > 0) {
                percentage = Math.round((actual / budget) * 100);
            }
            
            // Determine progress bar color
            let progressClass = "fill-green";
            if (type === "Dépense fixe" || type === "Dépense variable") {
                if (percentage > 100) {
                    progressClass = "fill-red";
                } else if (percentage > 70) {
                    progressClass = "fill-amber";
                }
            } else { // Incomes
                if (percentage >= 100) {
                    progressClass = "fill-green";
                } else {
                    progressClass = "fill-red";
                }
            }

            const barWidth = Math.min(100, percentage);

            return `
                <div class="budget-card">
                    <div class="budget-card-header">
                        <span class="budget-card-title">${escapeHTML(cat.name)}</span>
                        <div class="budget-card-actions">
                            <span class="budget-card-edit-btn" onclick="window.openBudgetModal('${escapeHTML(cat.name)}', '${type}', ${budget})">
                                <i class="fa-solid fa-pen-to-square"></i> Modifier
                            </span>
                            <span class="budget-card-delete-btn" title="Supprimer la catégorie" onclick="window.deleteCategory('${escapeHTML(cat.name)}')">
                                <i class="fa-solid fa-trash-can"></i>
                            </span>
                        </div>
                    </div>
                    <div class="budget-card-values">
                        <span>Réel: <strong>${formatCurrency(actual)}</strong></span>
                        <span>Cible: <strong>${formatCurrency(budget)}</strong></span>
                    </div>
                    <div class="progress-track" title="${percentage}% utilisé">
                        <div class="progress-fill ${progressClass}" style="width: ${barWidth}%"></div>
                    </div>
                </div>
            `;
        }).join("");
    }

    // Exposed globally so inline onclick handler can invoke it
    window.openBudgetModal = (name, type, currentBudget) => {
        document.getElementById("edit-budget-cat-name").value = name;
        document.getElementById("edit-budget-new-name").value = name;
        document.getElementById("edit-budget-cat-type").value = type;
        document.getElementById("edit-budget-amount").value = currentBudget;
        document.getElementById("edit-budget-scope").value = "recurring";
        document.getElementById("modal-budget").classList.remove("hidden");
    };

    async function saveBudgetLimit(e) {
        e.preventDefault();
        const oldName = document.getElementById("edit-budget-cat-name").value;
        const newName = document.getElementById("edit-budget-new-name").value.trim();
        const type = document.getElementById("edit-budget-cat-type").value;
        const amount = parseFloat(document.getElementById("edit-budget-amount").value) || 0.0;
        const scope = document.getElementById("edit-budget-scope").value;

        if (!newName) {
            showToast("Le nom de la catégorie ne peut pas être vide.", "error");
            return;
        }

        try {
            let activeName = oldName;
            
            // If renamed, execute rename first
            if (newName !== oldName) {
                const renameRes = await fetch("/api/categories/rename", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ old_name: oldName, new_name: newName })
                });
                
                if (renameRes.ok) {
                    showToast("Catégorie renommée.", "success");
                    activeName = newName;
                } else {
                    const errData = await renameRes.json();
                    showToast(errData.detail || "Erreur lors du renommage.", "error");
                    return;
                }
            }

            // Save budget limit
            let res;
            if (scope === "recurring") {
                res = await fetch("/api/categories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: activeName, type, monthly_budget: amount })
                });
            } else {
                res = await fetch("/api/monthly-budgets", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        category_name: activeName, 
                        month: state.selectedMonth, 
                        budget: amount 
                    })
                });
            }

            if (res.ok) {
                showToast("Budget enregistré.", "success");
                document.getElementById("modal-budget").classList.add("hidden");
                loadAllData(); // Refresh UI
            } else {
                showToast("Erreur d'enregistrement du budget.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    async function saveNewCategory(e) {
        e.preventDefault();
        const name = document.getElementById("add-cat-name").value.trim();
        const type = document.getElementById("add-cat-type").value;
        const budget = parseFloat(document.getElementById("add-cat-budget").value) || 0.0;

        if (!name) {
            showToast("Le nom de la catégorie est requis.", "error");
            return;
        }

        try {
            const res = await fetch("/api/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, type, monthly_budget: budget })
            });

            if (res.ok) {
                showToast("Catégorie créée avec succès.", "success");
                document.getElementById("modal-add-category").classList.add("hidden");
                document.getElementById("form-add-category").reset();
                loadAllData(); // Refresh UI
            } else {
                const errData = await res.json();
                showToast(errData.detail || "Erreur lors de la création.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    // Exposed globally so inline onclick handler can invoke it
    window.deleteCategory = async (name) => {
        if (!confirm(`Voulez-vous vraiment supprimer la catégorie "${name}" ?\n\nNote : Les transactions associées ne seront pas supprimées, mais perdront leur catégorie.`)) {
            return;
        }

        try {
            const res = await fetch(`/api/categories/${encodeURIComponent(name)}`, {
                method: "DELETE"
            });

            if (res.ok) {
                showToast("Catégorie supprimée.", "success");
                loadAllData(); // Refresh UI
            } else {
                const errData = await res.json();
                showToast(errData.detail || "Erreur lors de la suppression.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    };

    // -------------------------------------------------------------
    // EPARGNE & CREDITS PROJECTIONS
    // -------------------------------------------------------------
    async function loadEpargneData() {
        try {
            const res = await fetch("/api/stats");
            const data = await res.json();
            
            // Store details in state
            state.savingsDetails = data.savings_details;
            
            // 1. Savings Rates & Projection
            renderSavingsProjections(data.accounts, data.savings_rates, data.savings_details);
            
            // Refresh detailed view if an account is already selected
            if (selectedSavingsAccountId) {
                showSavingsAccountDetail(selectedSavingsAccountId);
            } else {
                const panel = document.getElementById("savings-detail-panel");
                if (panel) panel.classList.add("hidden");
            }
        } catch (err) {
            showToast("Erreur lors de la lecture des données d'épargne.", "error");
        }
    }

    let selectedLoanKey = null;
    let creditsData = null;

    async function loadCreditsData() {
        try {
            const res = await fetch("/api/stats");
            creditsData = await res.json();
            
            // Populate bank accounts dropdown for config
            const selectAcc = document.getElementById("loan-config-account-id");
            if (selectAcc) {
                const pretAccounts = creditsData.accounts.filter(a => a.type === "pret");
                selectAcc.innerHTML = '<option value="">-- Aucun (Prêt manuel) --</option>' + 
                    pretAccounts.map(a => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.label)} (${formatCurrency(Math.abs(a.balance))})</option>`).join("");
            }
            
            buildLoansList();
        } catch (err) {
            showToast("Erreur lors de la lecture des données de crédit.", "error");
        }
    }

    function buildLoansList() {
        const container = document.getElementById("loans-list-container");
        if (!container) return;
        
        container.innerHTML = "";
        
        const pretAccounts = creditsData.accounts.filter(a => a.type === "pret" && a.include_in_budget_and_list !== 0);
        const configuredLoans = creditsData.loans;
        
        const listItems = [];
        
        // 1. Process configured loans
        configuredLoans.forEach(loan => {
            const matchedAccount = loan.account_id ? pretAccounts.find(a => a.id === loan.account_id) : null;
            listItems.push({
                key: `manual_${loan.id}`,
                name: loan.name,
                loanId: loan.id,
                accountId: loan.account_id,
                isConfigured: true,
                isManual: !loan.account_id,
                balance: matchedAccount ? matchedAccount.balance : null,
                loanData: loan,
                accountData: matchedAccount
            });
        });
        
        // 2. Process remaining synced accounts that are not configured yet
        pretAccounts.forEach(acc => {
            const isAlreadyConfigured = configuredLoans.some(l => l.account_id === acc.id);
            if (!isAlreadyConfigured) {
                listItems.push({
                    key: `synced_${acc.id}`,
                    name: acc.label,
                    loanId: null,
                    accountId: acc.id,
                    isConfigured: false,
                    isManual: false,
                    balance: acc.balance,
                    loanData: null,
                    accountData: acc
                });
            }
        });
        
        if (listItems.length === 0) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center; opacity: 0.6; font-size: 0.85rem;">
                    Aucun prêt détecté ou configuré. Cliquez sur "Nouveau" pour en ajouter un.
                </div>
            `;
            document.getElementById("loan-info-card").innerHTML = `<p class="text-muted">Aucun prêt actif.</p>`;
            document.getElementById("loan-details-panel").classList.add("hidden");
            document.getElementById("loan-schedule-panel").classList.add("hidden");
            return;
        }
        
        document.getElementById("loan-details-panel").classList.remove("hidden");
        
        // Transition selectedLoanKey from synced_xxx to manual_yyy if it was just configured
        if (selectedLoanKey && selectedLoanKey.startsWith("synced_")) {
            const syncedAccId = selectedLoanKey.split("_")[1];
            const newlyConfigured = listItems.find(item => item.isConfigured && item.accountId === syncedAccId);
            if (newlyConfigured) {
                selectedLoanKey = newlyConfigured.key;
            }
        }
        
        // Default select first item if none is selected
        if (!selectedLoanKey || !listItems.some(item => item.key === selectedLoanKey)) {
            selectedLoanKey = listItems[0].key;
        }
        
        listItems.forEach(item => {
            const div = document.createElement("div");
            div.className = "clickable-row";
            div.style.padding = "12px 15px";
            div.style.borderRadius = "8px";
            div.style.cursor = "pointer";
            div.style.marginBottom = "8px";
            div.style.display = "flex";
            div.style.flexDirection = "column";
            div.style.gap = "4px";
            div.style.transition = "all 0.2s ease";
            
            if (item.key === selectedLoanKey) {
                div.style.background = "rgba(255, 255, 255, 0.08)";
                div.style.borderLeft = "3px solid var(--primary)";
            } else {
                div.style.background = "rgba(255, 255, 255, 0.02)";
                div.style.borderLeft = "3px solid transparent";
            }
            
            let badgeHtml = "";
            if (item.isConfigured) {
                if (item.isManual) {
                    badgeHtml = `<span class="badge" style="font-size: 0.65rem; background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px;">Manuel</span>`;
                } else {
                    badgeHtml = `<span class="badge" style="font-size: 0.65rem; background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 6px; border-radius: 4px;">Synchro</span>`;
                }
            } else {
                badgeHtml = `<span class="badge" style="font-size: 0.65rem; background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 2px 6px; border-radius: 4px;">Non configuré</span>`;
            }
            
            const balVal = item.balance !== null ? formatCurrency(Math.abs(item.balance)) : "N/A";
            const nameClean = item.name.replace(/Bourso - |CA - /gi, '');
            
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <strong style="font-size: 0.85rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 150px;">${escapeHTML(nameClean)}</strong>
                    ${badgeHtml}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; opacity: 0.8; margin-top: 2px;">
                    <span class="text-muted">${item.isManual ? 'Échéancier' : 'Solde restant'}</span>
                    <strong class="${item.balance !== null ? 'red-text' : ''}">${balVal}</strong>
                </div>
            `;
            
            div.addEventListener("click", () => {
                selectedLoanKey = item.key;
                buildLoansList();
            });
            
            container.appendChild(div);
        });
        
        // Show details of selected loan
        const activeItem = listItems.find(item => item.key === selectedLoanKey);
        if (activeItem) {
            displayLoanDetails(activeItem);
        }
    }

    function displayLoanDetails(item) {
        const titleEl = document.getElementById("loan-detail-title");
        titleEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> Détails : ${escapeHTML(item.name)}`;
        
        // Populate edit form values
        const formContainer = document.getElementById("loan-edit-form-container");
        formContainer.classList.add("hidden"); 
        
        const form = document.getElementById("form-loan-config");
        form.reset();
        
        const deleteBtn = document.getElementById("btn-delete-loan");
        
        if (item.isConfigured) {
            deleteBtn.style.display = "block";
            document.getElementById("loan-config-id").value = item.loanId;
            document.getElementById("loan-config-name").value = item.loanData.name;
            document.getElementById("loan-config-account-id").value = item.loanData.account_id || "";
            document.getElementById("loan-config-amount").value = item.loanData.amount;
            document.getElementById("loan-config-rate").value = item.loanData.rate;
            document.getElementById("loan-config-duration").value = item.loanData.duration_months;
            document.getElementById("loan-config-start-date").value = item.loanData.start_date;
            document.getElementById("loan-config-payment").value = item.loanData.monthly_payment;
            document.getElementById("loan-config-insurance").value = item.loanData.insurance || "0.00";
            
            document.getElementById("loan-info-card").classList.remove("hidden");
            document.getElementById("loan-schedule-panel").classList.remove("hidden");
            
            renderLoanDetailsCombined(item.loanData, item.accountData);
            renderAmortizationScheduleCombined(item.loanData);
        } else {
            // Unconfigured synced loan
            deleteBtn.style.display = "none";
            document.getElementById("loan-config-id").value = "";
            document.getElementById("loan-config-name").value = item.name;
            document.getElementById("loan-config-account-id").value = item.accountId;
            document.getElementById("loan-config-amount").value = Math.abs(item.balance); // Pre-fill amount with current negative balance (positive)
            document.getElementById("loan-config-rate").value = "";
            document.getElementById("loan-config-duration").value = "";
            document.getElementById("loan-config-start-date").value = "";
            document.getElementById("loan-config-payment").value = "";
            document.getElementById("loan-config-insurance").value = "0.00";
            
            document.getElementById("loan-info-card").innerHTML = `
                <div style="padding: 25px 20px; text-align: center; background: rgba(245, 158, 11, 0.05); border-radius: 8px; border: 1px dashed rgba(245, 158, 11, 0.2);">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.8rem; color: #fbbf24; margin-bottom: 10px;"></i>
                    <p style="margin: 0; font-size: 0.85rem; line-height: 1.5; color: #fbbf24;">
                        Ce compte emprunt importé n'a pas encore été configuré.<br>
                        Cliquez sur le bouton <strong>Configurer</strong> en haut à droite pour renseigner ses paramètres et générer son tableau d'amortissement.
                    </p>
                </div>
            `;
            document.getElementById("loan-schedule-panel").classList.add("hidden");
            
            // Auto-expand config form for unconfigured synced loans
            formContainer.classList.remove("hidden");
        }
    }

    let selectedSavingsAccountId = null;
    let modifiedMonthlyRates = {}; // Store modified rates as { month_num: rate_float }

    function renderSavingsProjections(accounts, rates, savingsDetails) {
        const tbody = document.querySelector("#table-savings-projection tbody");
        
        // Filter savings accounts (type = 'livret' and included)
        const livrets = accounts.filter(acc => acc.type === "livret" && acc.include_in_budget_and_list !== 0);
        
        if (livrets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Aucun livret d'épargne trouvé. Modifiez le type d'un de vos comptes bancaires dans la configuration.</td></tr>`;
            return;
        }

        let totalBalance = 0;
        let totalProjectedInterests = 0;

        const rowsHtml = livrets.map(liv => {
            // Find corresponding detail in savingsDetails
            const detail = savingsDetails ? savingsDetails.find(d => d.account_id === liv.id) : null;
            const projected = detail ? detail.total_interest : 0.0;
            
            const rateVal = detail ? detail.current_rate : 3.0;
            
            totalBalance += liv.balance;
            totalProjectedInterests += projected;

            const isSelected = selectedSavingsAccountId === liv.id ? "style='background: rgba(255,255,255,0.08) !important;'" : "";

            return `
                <tr class="clickable-savings-row" data-account-id="${liv.id}" ${isSelected} style="cursor: pointer;">
                    <td><strong>${escapeHTML(liv.label.split(" - ").slice(1).join(" - ") || liv.label)}</strong> <i class="fa-solid fa-chevron-right text-muted" style="font-size: 0.75rem; margin-left: 5px;"></i></td>
                    <td><span class="badge badge-muted">${rateVal.toFixed(2)} %</span></td>
                    <td class="text-right"><strong>${formatCurrency(liv.balance)}</strong></td>
                    <td class="text-right green-text"><strong>+${formatCurrency(projected)}</strong></td>
                </tr>
            `;
        }).join("");

        const footerHtml = `
            <tr style="background: rgba(255,255,255,0.03); border-top: 2px solid var(--border-glass)">
                <td><strong>TOTAL</strong></td>
                <td>-</td>
                <td class="text-right"><strong>${formatCurrency(totalBalance)}</strong></td>
                <td class="text-right green-text"><strong>+${formatCurrency(totalProjectedInterests)}</strong></td>
            </tr>
        `;

        tbody.innerHTML = rowsHtml + footerHtml;

        // Attach event listeners
        const rows = tbody.querySelectorAll(".clickable-savings-row");
        rows.forEach(row => {
            row.addEventListener("click", () => {
                rows.forEach(r => r.style.background = "");
                row.style.background = "rgba(255,255,255,0.08)";
                
                const accId = row.dataset.accountId;
                showSavingsAccountDetail(accId);
            });
        });
    }

    function showSavingsAccountDetail(accId) {
        selectedSavingsAccountId = accId;
        modifiedMonthlyRates = {}; // Reset overrides
        
        const detail = state.savingsDetails ? state.savingsDetails.find(d => d.account_id === accId) : null;
        if (!detail) return;
        
        document.getElementById("selected-savings-account-label").textContent = detail.label;
        document.getElementById("savings-detail-panel").classList.remove("hidden");
        
        const tbody = document.querySelector("#table-monthly-savings-detail tbody");
        tbody.innerHTML = "";
        
        detail.months.forEach(m => {
            const tr = document.createElement("tr");
            
            tr.innerHTML = `
                <td>${m.month_name}</td>
                <td class="text-right">${formatCurrency(m.balance)}</td>
                <td>
                    <div class="form-input-with-suffix" style="width: 120px;">
                        <input type="number" step="0.01" min="0" class="form-control text-right monthly-rate-input" data-month="${m.month}" value="${m.rate.toFixed(2)}" style="padding-right: 25px;">
                        <span class="suffix">%</span>
                    </div>
                </td>
                <td class="text-right green-text"><strong class="monthly-interest-display" data-month="${m.month}">+${formatCurrency(m.interest)}</strong></td>
            `;
            
            const input = tr.querySelector(".monthly-rate-input");
            input.addEventListener("input", () => {
                const newRate = parseFloat(input.value) || 0.0;
                modifiedMonthlyRates[m.month] = newRate;
                
                // Recalculate interest for this month in real time
                const newInterest = m.balance * (newRate / 100.0) / 12.0;
                tr.querySelector(".monthly-interest-display").textContent = `+${formatCurrency(newInterest)}`;
                
                // Recalculate total sum in real time
                recalculateTotalSavingsInterest(detail);
            });
            
            tbody.appendChild(tr);
        });
        
        const totalTr = document.createElement("tr");
        totalTr.style.background = "rgba(255,255,255,0.03)";
        totalTr.style.borderTop = "2px solid var(--border-glass)";
        totalTr.innerHTML = `
            <td><strong>TOTAL PROJETÉ</strong></td>
            <td class="text-right">-</td>
            <td>-</td>
            <td class="text-right green-text"><strong id="total-monthly-savings-interest">+${formatCurrency(detail.total_interest)}</strong></td>
        `;
        tbody.appendChild(totalTr);
    }

    function recalculateTotalSavingsInterest(detail) {
        let total = 0.0;
        detail.months.forEach(m => {
            const rate = modifiedMonthlyRates[m.month] !== undefined ? modifiedMonthlyRates[m.month] : m.rate;
            total += m.balance * (rate / 100.0) / 12.0;
        });
        document.getElementById("total-monthly-savings-interest").textContent = `+${formatCurrency(total)}`;
    }

    async function saveMonthlySavingsRates() {
        if (!selectedSavingsAccountId) return;
        
        const currentYear = new Date().getFullYear();
        const promises = [];
        
        for (const [month, rate] of Object.entries(modifiedMonthlyRates)) {
            promises.push(
                fetch("/api/monthly-savings-rates", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        account_id: selectedSavingsAccountId,
                        year: currentYear,
                        month: parseInt(month),
                        rate: rate
                    })
                })
            );
        }
        
        if (promises.length === 0) {
            showToast("Aucun changement de taux à enregistrer.", "info");
            return;
        }
        
        try {
            await Promise.all(promises);
            showToast("Taux mensuels enregistrés avec succès.", "success");
            
            // Reload and refresh
            const res = await fetch("/api/stats");
            const data = await res.json();
            state.savingsDetails = data.savings_details;
            
            renderSavingsProjections(data.accounts, data.savings_rates, data.savings_details);
            showSavingsAccountDetail(selectedSavingsAccountId);
        } catch (err) {
            showToast("Erreur lors de l'enregistrement des taux mensuels.", "error");
        }
    }

    function renderLoanDetailsCombined(loan, account) {
        const card = document.getElementById("loan-info-card");
        if (!card) return;
        
        const startDate = new Date(loan.start_date);
        const today = new Date();
        const elapsedMonths = Math.max(0, (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth()));
        
        const schedule = generateAmortizationScheduleCombined(loan);
        
        let remainingCapital = 0;
        let isSyncedReal = false;
        
        if (account) {
            remainingCapital = Math.abs(account.balance);
            isSyncedReal = true;
        } else {
            const currentPay = schedule[Math.min(schedule.length - 1, elapsedMonths)] || { remaining: 0 };
            remainingCapital = currentPay.remaining;
        }
        
        const capitalRebuilt = Math.max(0, loan.amount - remainingCapital);
        const progressPercent = Math.min(100, Math.round((capitalRebuilt / loan.amount) * 100));
        const insuranceVal = loan.insurance || 0;

        card.innerHTML = `
            <div class="loan-meta-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px;">
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Compte associé</span>
                    <strong class="val" style="font-size: 0.9rem; color: var(--primary);">${account ? escapeHTML(account.label) : 'Aucun (Prêt manuel)'}</strong>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Capital emprunté d'origine</span>
                    <span class="val" style="font-size: 0.9rem; font-weight: 600;">${formatCurrency(loan.amount)}</span>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Mensualité (hors assurance)</span>
                    <span class="val" style="font-size: 0.9rem;">${formatCurrency(loan.monthly_payment)} / mois</span>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Assurance mensuelle</span>
                    <span class="val" style="font-size: 0.9rem;">${formatCurrency(insuranceVal)} / mois</span>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Taux d'intérêt annuel</span>
                    <span class="val" style="font-size: 0.9rem;">${loan.rate.toFixed(2)} %</span>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Remboursé à ce jour</span>
                    <span class="val green-text" style="font-size: 0.9rem; font-weight: 600;">${formatCurrency(capitalRebuilt)}</span>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Capital restant dû ${isSyncedReal ? '(Réel)' : '(Théorique)'}</span>
                    <span class="val red-text" style="font-size: 0.9rem; font-weight: 600;">${formatCurrency(remainingCapital)}</span>
                </div>
                <div class="loan-meta-item">
                    <span class="lbl" style="font-size: 0.75rem; opacity: 0.7; display: block; margin-bottom: 2px;">Mensualité totale payée</span>
                    <span class="val" style="font-size: 0.9rem; font-weight: 600;">${formatCurrency(loan.monthly_payment + insuranceVal)} / mois</span>
                </div>
            </div>
            
            <div class="loan-progress-box" style="margin-top: 20px;">
                <div class="loan-progress-label" style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 5px;">
                    <span>Progression du remboursement</span>
                    <strong>${progressPercent}% (${Math.min(loan.duration_months, elapsedMonths)} / ${loan.duration_months} mois)</strong>
                </div>
                <div class="progress-track" style="height: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; overflow: hidden;">
                    <div class="progress-fill fill-green" style="width: ${progressPercent}%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;
    }

    function renderAmortizationScheduleCombined(loan) {
        const tbody = document.querySelector("#table-loan-schedule tbody");
        if (!tbody) return;
        
        const schedule = generateAmortizationScheduleCombined(loan);
        
        const startDate = new Date(loan.start_date);
        const today = new Date();
        const currentIdx = Math.max(0, (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth())) - 1;

        tbody.innerHTML = schedule.map((row, idx) => {
            const isCurrent = idx === currentIdx;
            const highlightClass = isCurrent ? "style='background: rgba(95, 90, 246, 0.1); border-left: 3px solid var(--primary)'" : "";
            
            const dateStr = new Date(row.date).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
            
            return `
                <tr ${highlightClass}>
                    <td><strong>N° ${row.number}</strong></td>
                    <td class="text-muted">${dateStr}</td>
                    <td class="text-right">${formatCurrency(row.principal)}</td>
                    <td class="text-right text-muted">${formatCurrency(row.interest)}</td>
                    <td class="text-right text-muted">${formatCurrency(row.insurance)}</td>
                    <td class="text-right"><strong>${formatCurrency(row.payment)}</strong></td>
                    <td class="text-right ${isCurrent ? "red-text" : "text-muted"}"><strong>${formatCurrency(row.remaining)}</strong></td>
                </tr>
            `;
        }).join("");
    }

    function generateAmortizationScheduleCombined(loan) {
        const schedule = [];
        let remaining = loan.amount;
        
        const r = (loan.rate / 100) / 12;
        const n = loan.duration_months;
        const m = loan.monthly_payment;
        const ins = loan.insurance || 0.0;
        const startDate = new Date(loan.start_date);
        
        for (let i = 1; i <= n; i++) {
            const interest = remaining * r;
            let principal = m - interest;
            
            if (remaining < principal) {
                principal = remaining;
            }
            
            remaining -= principal;
            
            const date = new Date(startDate);
            date.setMonth(startDate.getMonth() + i);
            
            schedule.push({
                number: i,
                date: date.toISOString().split('T')[0],
                interest: interest,
                principal: principal,
                insurance: ins,
                payment: interest + principal + ins,
                remaining: Math.max(0, remaining)
            });
            
            if (remaining <= 0) break;
        }
        return schedule;
    }

    // -------------------------------------------------------------
    // ANNUAL SYNTHESIS VIEW LOGIC
    // -------------------------------------------------------------
    async function loadSynthesisData() {
        try {
            // Get stats for the selected year
            const statsRes = await fetch(`/api/stats?year=${state.year}`);
            const data = await statsRes.json();
            
            const mode = document.querySelector('input[name="synthesis-mode"]:checked').value;
            const container = document.getElementById("table-synthesis");
            if (!container) return;
            
            // Months of the year
            const months = Array.from({ length: 12 }, (_, i) => `${state.year}-${String(i + 1).padStart(2, '0')}`);
            const monthLabels = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
            
            // Header Row HTML
            let html = `
                <thead>
                    <tr>
                        <th>Catégorie</th>
                        ${monthLabels.map(m => `<th>${m}</th>`).join("")}
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
            `;
            
            // Group categories by type
            const categoriesByType = {
                "Revenu": [],
                "Dépense fixe": [],
                "Dépense variable": []
            };
            
            data.categories.forEach(cat => {
                if (categoriesByType[cat.type] !== undefined) {
                    categoriesByType[cat.type].push(cat);
                }
            });
            
            // Sort categories alphabetically
            for (const type in categoriesByType) {
                categoriesByType[type].sort((a, b) => a.name.localeCompare(b.name));
            }
            
            // Subtotals arrays (tracking both real and budget totals for comparison)
            const monthlyTotals = {
                income: Array(12).fill(0),
                fixed: Array(12).fill(0),
                variable: Array(12).fill(0),
                incomeBudget: Array(12).fill(0),
                fixedBudget: Array(12).fill(0),
                variableBudget: Array(12).fill(0)
            };
            
            // Render group helper
            function renderCategoryGroup(groupName, cats, typeKey) {
                let groupHtml = `<tr class="group-header"><td colspan="14">${groupName}</td></tr>`;
                
                cats.forEach(cat => {
                    let rowHtml = `<tr><td><strong>${escapeHTML(cat.name)}</strong></td>`;
                    let rowTotal = 0;
                    
                    for (let i = 0; i < 12; i++) {
                        const m = months[i];
                        const mData = data.monthly_data[m] || { details: {}, budgets: {} };
                        
                        let realVal = mData.details[cat.name] || 0.0;
                        let budgetVal = mData.budgets[cat.name] || 0.0;
                        
                        let val = mode === "real" ? realVal : budgetVal;
                        
                        rowTotal += val;
                        monthlyTotals[typeKey][i] += val;
                        monthlyTotals[typeKey + "Budget"][i] += budgetVal;
                        
                        let cellClass = "";
                        let dataAttrs = "";
                        if (val === 0) {
                            cellClass = "text-muted";
                        } else if (mode === "real" && budgetVal > 0) {
                            const valRounded = parseFloat(val.toFixed(2));
                            const budgetValRounded = parseFloat(budgetVal.toFixed(2));
                            if (cat.type === "Revenu") {
                                cellClass = valRounded >= budgetValRounded ? "synthesis-cell-underbudget" : "synthesis-cell-overbudget";
                            } else {
                                cellClass = valRounded > budgetValRounded ? "synthesis-cell-overbudget" : "synthesis-cell-underbudget";
                            }
                        }
                        
                        if (mode === "budget") {
                            cellClass += " editable-cell";
                            dataAttrs = `data-category="${escapeHTML(cat.name)}" data-month="${m}" data-value="${val}"`;
                        }
                        
                        rowHtml += `<td class="${cellClass}" ${dataAttrs}>${val !== 0 ? formatCurrency(val) : '-'}</td>`;
                    }
                    
                    rowHtml += `<td><strong>${formatCurrency(rowTotal)}</strong></td></tr>`;
                    groupHtml += rowHtml;
                });
                
                // Group Subtotal Row
                let subtotalHtml = `<tr class="group-subtotal"><td><strong>Total ${groupName}</strong></td>`;
                let groupYearTotal = 0;
                
                for (let i = 0; i < 12; i++) {
                    const mVal = monthlyTotals[typeKey][i];
                    const mBudgetVal = monthlyTotals[typeKey + "Budget"][i];
                    groupYearTotal += mVal;
                    
                    let cellClass = "";
                    if (mode === "real" && mBudgetVal > 0 && mVal > 0) {
                        const mValRounded = parseFloat(mVal.toFixed(2));
                        const mBudgetValRounded = parseFloat(mBudgetVal.toFixed(2));
                        if (typeKey === "income") {
                            cellClass = mValRounded >= mBudgetValRounded ? "synthesis-cell-underbudget" : "synthesis-cell-overbudget";
                        } else {
                            cellClass = mValRounded > mBudgetValRounded ? "synthesis-cell-overbudget" : "synthesis-cell-underbudget";
                        }
                    }
                    
                    subtotalHtml += `<td class="${cellClass}"><strong>${mVal !== 0 ? formatCurrency(mVal) : '-'}</strong></td>`;
                }
                
                subtotalHtml += `<td><strong>${formatCurrency(groupYearTotal)}</strong></td></tr>`;
                groupHtml += subtotalHtml;
                
                return groupHtml;
            }
            
            // 1. REVENUS
            html += renderCategoryGroup("Revenus", categoriesByType["Revenu"], "income");
            
            // 2. DÉPENSES FIXES
            html += renderCategoryGroup("Dépenses Fixes", categoriesByType["Dépense fixe"], "fixed");
            
            // 3. DÉPENSES VARIABLES
            html += renderCategoryGroup("Dépenses Variables", categoriesByType["Dépense variable"], "variable");
            
            // 4. SYNTHÈSE BLOCK
            html += `<tr class="group-header"><td colspan="14">Synthèse Mensuelle</td></tr>`;
            
            // Total Revenus
            let revRow = `<tr class="synthesis-row-total"><td>Revenus</td>`;
            let revYearTotal = 0;
            for (let i = 0; i < 12; i++) {
                const val = monthlyTotals.income[i];
                const budgetVal = monthlyTotals.incomeBudget[i];
                revYearTotal += val;
                
                let cellClass = "";
                if (mode === "real" && budgetVal > 0 && val > 0) {
                    const valRounded = parseFloat(val.toFixed(2));
                    const budgetValRounded = parseFloat(budgetVal.toFixed(2));
                    cellClass = valRounded >= budgetValRounded ? "synthesis-cell-underbudget" : "synthesis-cell-overbudget";
                }
                
                revRow += `<td class="${cellClass}">${formatCurrency(val)}</td>`;
            }
            revRow += `<td><strong>${formatCurrency(revYearTotal)}</strong></td></tr>`;
            html += revRow;
            
            // Total Dépenses
            let depRow = `<tr class="synthesis-row-total"><td>Dépenses (Fixes + Var.)</td>`;
            let depYearTotal = 0;
            for (let i = 0; i < 12; i++) {
                const val = monthlyTotals.fixed[i] + monthlyTotals.variable[i];
                const budgetVal = monthlyTotals.fixedBudget[i] + monthlyTotals.variableBudget[i];
                depYearTotal += val;
                
                let cellClass = "";
                if (mode === "real" && budgetVal > 0 && val > 0) {
                    const valRounded = parseFloat(val.toFixed(2));
                    const budgetValRounded = parseFloat(budgetVal.toFixed(2));
                    cellClass = valRounded > budgetValRounded ? "synthesis-cell-overbudget" : "synthesis-cell-underbudget";
                }
                
                depRow += `<td class="${cellClass}">${formatCurrency(val)}</td>`;
            }
            depRow += `<td><strong>${formatCurrency(depYearTotal)}</strong></td></tr>`;
            html += depRow;
            
            // Reste à vivre (Solde)
            let netRow = `<tr class="synthesis-row-net"><td>Reste à vivre (Solde)</td>`;
            let netYearTotal = 0;
            for (let i = 0; i < 12; i++) {
                const val = monthlyTotals.income[i] - (monthlyTotals.fixed[i] + monthlyTotals.variable[i]);
                netYearTotal += val;
                const glowClass = val >= 0 ? "green-bg-glow" : "red-bg-glow";
                netRow += `<td class="${glowClass}">${val >= 0 ? '+' : ''}${formatCurrency(val)}</td>`;
            }
            const overallGlowClass = netYearTotal >= 0 ? "green-bg-glow" : "red-bg-glow";
            netRow += `<td class="${overallGlowClass}"><strong>${netYearTotal >= 0 ? '+' : ''}${formatCurrency(netYearTotal)}</strong></td></tr>`;
            html += netRow;
            
            // Taux d'Épargne
            let rateRow = `<tr class="synthesis-row-rate"><td>Taux d'Épargne</td>`;
            for (let i = 0; i < 12; i++) {
                const inc = monthlyTotals.income[i];
                const exp = monthlyTotals.fixed[i] + monthlyTotals.variable[i];
                let rate = 0;
                if (inc > 0) {
                    rate = Math.round(((inc - exp) / inc) * 100);
                }
                rateRow += `<td class="${rate > 0 ? 'green-text' : (rate < 0 ? 'red-text' : 'text-muted')}">${inc > 0 ? rate + ' %' : '-'}</td>`;
            }
            let overallRate = 0;
            if (revYearTotal > 0) {
                overallRate = Math.round(((revYearTotal - depYearTotal) / revYearTotal) * 100);
            }
            rateRow += `<td><strong>${overallRate} %</strong></td></tr>`;
            html += rateRow;
            
            // Virements internes row
            let transfersByType = [];
            data.categories.forEach(cat => {
                if (cat.type === "Transfert") {
                    transfersByType.push(cat);
                }
            });
            
            let transRow = `<tr><td class="text-muted">dont Virements internes</td>`;
            let transYearTotal = 0;
            for (let i = 0; i < 12; i++) {
                const m = months[i];
                const mData = data.monthly_data[m] || { details: {}, budgets: {} };
                let val = 0;
                
                transfersByType.forEach(cat => {
                    if (mode === "real") {
                        val += mData.details[cat.name] || 0.0;
                    } else {
                        val += mData.budgets[cat.name] || 0.0;
                    }
                });
                
                transYearTotal += val;
                transRow += `<td class="text-muted">${val !== 0 ? formatCurrency(val) : '-'}</td>`;
            }
            transRow += `<td class="text-muted"><strong>${formatCurrency(transYearTotal)}</strong></td></tr>`;
            html += transRow;
            
            html += `</tbody>`;
            container.innerHTML = html;
        } catch (err) {
            console.error("Synthesis error:", err);
            showToast("Erreur lors du chargement de la synthèse annuelle.", "error");
        }
    }

    // -------------------------------------------------------------
    // CONFIGURATION VIEW LOGIC
    // -------------------------------------------------------------
    async function loadConfigData() {
        loadBackendsList();
        loadAccountsConfigList();
        loadSavingsRatesConfig();
        loadAutoRulesList();
        loadLogsHistory();
    }

    async function loadAccountsConfigList() {
        try {
            const res = await fetch("/api/accounts");
            const accounts = await res.json();
            
            const container = document.getElementById("accounts-config-list");
            if (!container) return;
            
            if (accounts.length === 0) {
                container.innerHTML = `<p style="font-size:0.8rem; opacity:0.6; text-align:center; padding: 10px;">Aucun compte bancaire détecté. Lancez une synchronisation.</p>`;
                return;
            }
            
            container.innerHTML = accounts.map(a => {
                const includeVal = a.include_in_budget_and_list !== undefined ? a.include_in_budget_and_list : 1;
                const isChecked = includeVal === 1;
                return `
                    <div class="account-config-item">
                        <div class="account-config-info">
                            <h4 style="display: flex; align-items: center; gap: 8px;">
                                ${escapeHTML(a.label)}
                                <button onclick="window.renameAccount('${escapeHTML(a.id)}', '${escapeHTML(a.label.replace(/'/g, "\\'"))}')" class="btn btn-secondary btn-sm" style="padding: 1px 4px; font-size: 0.75rem; background: transparent; border: none; opacity: 0.6; cursor: pointer; color: var(--primary);" title="Renommer le compte">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </h4>
                            <span>N° ${escapeHTML(a.id)} | Solde: ${formatCurrency(a.balance)}</span>
                        </div>
                        <div class="account-config-action">
                            <label class="switch">
                                <input type="checkbox" onchange="window.toggleAccountBudgetFlag('${escapeHTML(a.id)}', this.checked)" ${isChecked ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                `;
            }).join("");
        } catch (err) {
            console.error("Failed to load accounts config list:", err);
        }
    }

    window.renameAccount = async (accountId, currentLabel) => {
        const newLabel = prompt("Entrez le nouveau nom pour ce compte :", currentLabel);
        if (newLabel === null) return;
        const trimmed = newLabel.trim();
        if (!trimmed) {
            showToast("Le nom du compte ne peut pas être vide.", "error");
            return;
        }
        
        try {
            const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/rename`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: trimmed })
            });
            
            if (res.ok) {
                showToast("Compte renommé avec succès.", "success");
                loadAccountsConfigList();
                loadDashboardData();
                loadTransactionsData();
            } else {
                const data = await res.json();
                showToast(data.detail || "Erreur lors du renommage.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    };

    window.toggleAccountBudgetFlag = async (accountId, isChecked) => {
        try {
            const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/budget-flag`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ include: isChecked })
            });
            
            if (res.ok) {
                showToast("Statut budgétaire du compte mis à jour.", "success");
                loadAccountsConfigList();
                loadDashboardData();
                loadTransactionsData();
            } else {
                showToast("Erreur lors de la mise à jour.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    };

    // Backends Connectors
    async function loadBackendsList() {
        try {
            const res = await fetch("/api/backends");
            const backends = await res.json();
            
            const container = document.getElementById("backends-list");
            
            if (backends.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-circle-info"></i>
                        <p>Aucun connecteur de banque configuré.</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = backends.map(b => `
                <div class="backend-item">
                    <div class="backend-info">
                        <div class="bank-avatar"><i class="fa-solid fa-bank"></i></div>
                        <div class="backend-meta">
                            <h4>${escapeHTML(b.name)}</h4>
                            <span>Module: ${escapeHTML(b.module)} | Client: ${escapeHTML(b.config.login || 'N/A')}</span>
                        </div>
                    </div>
                    <div class="backend-actions">
                        <span class="badge ${b.active ? 'badge-success' : 'badge-muted'}">${b.active ? 'Actif' : 'Inactif'}</span>
                        <button class="action-icon-btn" onclick="window.editBackend('${escapeHTML(b.name)}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-icon-btn delete-btn" onclick="window.removeBackend('${escapeHTML(b.name)}')" title="Supprimer"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            `).join("");
        } catch (err) {
            showToast("Erreur lors de la lecture des banques.", "error");
        }
    }

    window.editBackend = async (name) => {
        try {
            const res = await fetch("/api/backends");
            const backends = await res.json();
            const b = backends.find(item => item.name === name);
            if (b) {
                document.getElementById("bank_old_name").value = b.name;
                document.getElementById("bank_name").value = b.name;
                document.getElementById("bank_module").value = b.module;
                document.getElementById("bank_login").value = b.config.login || "";
                document.getElementById("bank_password").value = b.config.password || "";
                document.getElementById("bank_active").checked = b.active;
                
                document.getElementById("bank-form-title").textContent = "Modifier la banque";
                document.getElementById("bank-form-container").classList.remove("hidden");
                document.getElementById("custom-module-group").classList.add("hidden");
                
                // Load dynamic fields with existing configuration
                await loadDynamicFields(b.module, b.config);
            }
        } catch (err) {
            showToast("Impossible de charger la banque.", "error");
        }
    };

    window.removeBackend = async (name) => {
        if (!confirm(`Supprimer la banque '${name}' ? Toutes les configurations de comptes Woob associées seront perdues.`)) {
            return;
        }
        try {
            const res = await fetch(`/api/backends/${encodeURIComponent(name)}`, { method: "DELETE" });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, "success");
                loadConfigData();
            } else {
                showToast(data.detail || "Erreur de suppression.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    };

    function showAddBankForm() {
        document.getElementById("form-bank").reset();
        document.getElementById("bank_old_name").value = "";
        document.getElementById("additional-fields-container").innerHTML = "";
        document.getElementById("bank-form-title").textContent = "Ajouter une banque";
        document.getElementById("bank-form-container").classList.remove("hidden");
    }

    function hideBankForm() {
        document.getElementById("bank-form-container").classList.add("hidden");
    }

    async function loadDynamicFields(moduleName, existingConfig = {}) {
        const container = document.getElementById("additional-fields-container");
        container.innerHTML = "";
        
        if (!moduleName || moduleName === "custom") {
            return;
        }
        
        try {
            const res = await fetch(`/api/woob/modules/${encodeURIComponent(moduleName)}/config`);
            if (!res.ok) return;
            const fields = await res.json();
            
            if (fields.length === 0) return;
            
            let html = '<div class="dynamic-bank-fields" style="margin-top: 15px;">';
            fields.forEach(f => {
                const val = existingConfig[f.key] !== undefined ? existingConfig[f.key] : (f.default || "");
                html += `<div class="form-group" style="margin-bottom: 15px;">
                    <label for="dyn_${f.key}">${escapeHTML(f.label)} ${f.required ? '*' : ''}</label>`;
                
                if (f.type === "select") {
                    html += `<select id="dyn_${f.key}" name="${f.key}" class="dyn-field" style="width: 100%;" ${f.required ? 'required' : ''}>
                        <option value="">-- Choisir --</option>
                        ${f.choices.map(c => `<option value="${escapeHTML(c.value)}" ${c.value === val ? 'selected' : ''}>${escapeHTML(c.label)}</option>`).join("")}
                    </select>`;
                } else {
                    html += `<input type="${f.type}" id="dyn_${f.key}" name="${f.key}" class="dyn-field" value="${escapeHTML(val)}" placeholder="${escapeHTML(f.label)}" ${f.required ? 'required' : ''}>`;
                }
                html += `</div>`;
            });
            html += '</div>';
            container.innerHTML = html;
        } catch (err) {
            console.error("Failed to load dynamic fields:", err);
        }
    }

    function handleBankModuleChange() {
        const val = document.getElementById("bank_module").value;
        if (val === "custom") {
            document.getElementById("custom-module-group").classList.remove("hidden");
            document.getElementById("custom_module").required = true;
            loadDynamicFields(null);
        } else {
            document.getElementById("custom-module-group").classList.add("hidden");
            document.getElementById("custom_module").required = false;
            loadDynamicFields(val);
        }
    }

    async function saveBankConfig(e) {
        e.preventDefault();
        const oldName = document.getElementById("bank_old_name").value;
        const name = document.getElementById("bank_name").value.trim();
        let module = document.getElementById("bank_module").value;
        if (module === "custom") {
            module = document.getElementById("custom_module").value.trim();
        }
        const login = document.getElementById("bank_login").value.trim();
        const password = document.getElementById("bank_password").value.trim();
        const active = document.getElementById("bank_active").checked;

        const config = { login, password };
        document.querySelectorAll("#additional-fields-container .dyn-field").forEach(el => {
            config[el.name] = el.value.trim();
        });

        const payload = {
            name,
            module,
            config,
            active
        };

        try {
            // If renaming, we delete the old one first
            if (oldName && oldName !== name) {
                await fetch(`/api/backends/${encodeURIComponent(oldName)}`, { method: "DELETE" });
            }

            const res = await fetch("/api/backends", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast("Configuration bancaire enregistrée.", "success");
                hideBankForm();
                loadConfigData();
            } else {
                const data = await res.json();
                showToast(data.detail || "Erreur lors de l'enregistrement.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    // Savings rates config
    async function loadSavingsRatesConfig() {
        try {
            const res = await fetch("/api/savings-rates");
            const rates = await res.json();
            
            const fieldsContainer = document.getElementById("rates-config-fields");
            fieldsContainer.innerHTML = rates.map(rate => `
                <div class="form-group">
                    <label for="rate-${escapeHTML(rate.account_type)}">Taux d'intérêt ${escapeHTML(rate.account_type)} (%)</label>
                    <input type="number" id="rate-${escapeHTML(rate.account_type)}" data-type="${escapeHTML(rate.account_type)}" step="0.1" value="${rate.rate.toFixed(2)}" required>
                </div>
            `).join("");
        } catch (err) {
            console.error("Rates fetch error:", err);
        }
    }

    async function saveSavingsRates(e) {
        e.preventDefault();
        const inputs = document.querySelectorAll("#rates-config-fields input");
        
        try {
            for (const input of inputs) {
                const account_type = input.dataset.type;
                const rate = parseFloat(input.value) || 0.0;
                
                await fetch("/api/savings-rates", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ account_type, rate })
                });
            }
            showToast("Taux enregistrés avec succès.", "success");
            loadEpargneData();
        } catch (err) {
            showToast("Erreur réseau lors de la sauvegarde des taux.", "error");
        }
    }

    // Auto tri / rules list
    async function loadAutoRulesList() {
        try {
            const res = await fetch("/api/rules");
            const rules = await res.json();
            
            const tbody = document.querySelector("#table-rules tbody");
            if (rules.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Aucune règle d'auto-tri.</td></tr>`;
                return;
            }

            tbody.innerHTML = rules.map(r => `
                <tr>
                    <td><strong>${escapeHTML(r.pattern)}</strong></td>
                    <td>${escapeHTML(r.category)}</td>
                    <td><span class="badge badge-muted">${escapeHTML(r.type)}</span></td>
                    <td class="text-right">
                        <button class="action-icon-btn delete-btn" onclick="window.removeRule(${r.id})" title="Supprimer"><i class="fa-solid fa-trash-can"></i></button>
                    </td>
                </tr>
            `).join("");
        } catch (err) {
            showToast("Erreur lors de la lecture des règles.", "error");
        }
    }

    window.removeRule = async (id) => {
        try {
            const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
            if (res.ok) {
                showToast("Règle supprimée.", "success");
                loadConfigData();
            } else {
                showToast("Erreur de suppression.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    };

    async function saveAutoRule(e) {
        e.preventDefault();
        const pattern = document.getElementById("rule_pattern").value.trim();
        const category = document.getElementById("rule_category").value;
        
        // Find category type
        const catInfo = state.categories.find(c => c.name === category);
        const r_type = catInfo ? catInfo.type : "Dépense variable";

        try {
            const res = await fetch("/api/rules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pattern, category, type: r_type })
            });

            if (res.ok) {
                showToast("Règle ajoutée avec succès.", "success");
                document.getElementById("rule-form-container").classList.add("hidden");
                document.getElementById("form-rule").reset();
                loadConfigData();
            } else {
                showToast("Erreur lors de l'enregistrement de la règle.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    // GENERAL SETTINGS SCHEDULER
    async function loadGeneralSettings() {
        try {
            const res = await fetch("/api/settings");
            const settings = await res.json();
            
            document.getElementById("sync_interval_hours").value = settings.sync_interval_hours;
            const statIntervalEl = document.getElementById("stat-interval-hours");
            if (statIntervalEl) {
                statIntervalEl.textContent = `${settings.sync_interval_hours}h`;
            }
        } catch (err) {
            console.error("Settings load error:", err);
        }
    }

    async function saveGeneralSettings(e) {
        e.preventDefault();
        const sync_interval_hours = parseInt(document.getElementById("sync_interval_hours").value);

        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sync_interval_hours })
            });

            if (res.ok) {
                showToast("Paramètres de planification mis à jour.", "success");
                loadGeneralSettings();
            } else {
                showToast("Erreur lors de l'enregistrement des paramètres.", "error");
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    // -------------------------------------------------------------
    // RUN AUTOMATIC OR MANUAL TASK POLLINGS
    // -------------------------------------------------------------
    async function triggerSync() {
        const btn = document.getElementById("btn-sync-now");
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> En cours...`;
        
        try {
            const res = await fetch("/api/sync", { method: "POST" });
            const data = await res.json();
            
            if (res.ok) {
                showToast(data.message, "info");
                // Immediately refresh log view and start active checking
                refreshGlobalStatus();
                if (state.currentView === "config") {
                    loadLogsHistory();
                }
            } else {
                showToast(data.message || "Erreur de lancement.", "error");
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-rotate"></i> Synchroniser maintenant`;
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-rotate"></i> Synchroniser maintenant`;
        }
    }

    async function triggerWoobUpdate() {
        const btn = document.getElementById("btn-update-woob");
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mise à jour...`;

        try {
            const res = await fetch("/api/woob/update", { method: "POST" });
            const data = await res.json();
            
            if (res.ok) {
                showToast(data.message, "info");
                refreshGlobalStatus();
            } else {
                showToast(data.message || "Erreur de lancement.", "error");
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Mettre à jour Woob`;
            }
        } catch (err) {
            showToast("Erreur réseau.", "error");
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Mettre à jour Woob`;
        }
    }

    async function refreshGlobalStatus() {
        try {
            const res = await fetch("/api/status");
            const data = await res.json();
            
            const dot = document.getElementById("global-status-dot");
            const label = document.getElementById("global-status-label");
            const lastSyncText = document.getElementById("last-sync-text");
            
            // Sync now button update
            const btnSync = document.getElementById("btn-sync-now");
            const btnUpdate = document.getElementById("btn-update-woob");

            if (data.is_sync_running) {
                dot.className = "status-dot blue";
                label.textContent = "Synchronisation en cours...";
                btnSync.disabled = true;
                btnSync.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> En cours...`;
            } else {
                btnSync.disabled = false;
                btnSync.innerHTML = `<i class="fa-solid fa-rotate"></i> Synchroniser maintenant`;
                
                if (data.last_sync_status === "SUCCESS") {
                    dot.className = "status-dot green";
                    label.textContent = "Prêt / Réussi";
                } else if (data.last_sync_status === "FAILED" || data.last_sync_status === "PARTIAL_FAILED") {
                    dot.className = "status-dot red";
                    label.textContent = "Dernière sync échouée";
                } else {
                    dot.className = "status-dot yellow";
                    label.textContent = "Prêt / Aucune sync";
                }
            }

            if (data.is_update_running) {
                btnUpdate.disabled = true;
                btnUpdate.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> En cours...`;
            } else {
                btnUpdate.disabled = false;
                btnUpdate.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Mettre à jour Woob`;
            }

            const timeStr = data.last_sync_time ? new Date(data.last_sync_time).toLocaleString("fr-FR") : "Jamais";
            lastSyncText.textContent = timeStr;
            
            // Reload page data once sync stops running
            if (!data.is_sync_running && state.lastSyncRunningState === true) {
                showToast("La synchronisation est terminée !", "success");
                loadAllData();
            }
            state.lastSyncRunningState = data.is_sync_running;
        } catch (err) {
            console.error("Status fetch error:", err);
        }
    }

    // Execution logs
    async function loadLogsHistory() {
        try {
            const res = await fetch("/api/logs?limit=100");
            const logs = await res.json();
            
            const terminal = document.getElementById("log-terminal");
            
            if (logs.length === 0) {
                terminal.innerHTML = `<div class="log-line"><span class="log-msg text-muted">Aucun log d'exécution disponible.</span></div>`;
                return;
            }

            const isScrolledToBottom = terminal.scrollHeight - terminal.clientHeight <= terminal.scrollTop + 20;

            terminal.innerHTML = logs.reverse().map(l => {
                const time = l.timestamp ? l.timestamp.split("T")[1].substring(0, 8) : "";
                const detailsHtml = l.details ? `<span class="log-details">${escapeHTML(l.details)}</span>` : "";
                
                let statusClass = "log-status-info";
                if (l.status === "SUCCESS") statusClass = "log-status-success";
                else if (l.status === "FAILED") statusClass = "log-status-failed";
                else if (l.status === "IN_PROGRESS") statusClass = "log-status-progress";

                return `
                    <div class="log-line">
                        <span class="log-time">[${time}]</span>
                        <span class="log-status ${statusClass}">${l.status}</span>
                        <div class="log-msg-wrapper">
                            <span class="log-msg">${escapeHTML(l.message)}</span>
                            ${detailsHtml}
                        </div>
                    </div>
                `;
            }).join("");

            // Autoscroll to bottom if it was previously at bottom
            if (isScrolledToBottom) {
                terminal.scrollTop = terminal.scrollHeight;
            }
        } catch (err) {
            console.error("Logs fetch error:", err);
        }
    }

    async function clearLogsHistory() {
        if (!confirm("Vider l'historique complet de la console de logs ?")) return;
        try {
            await fetch("/api/logs/clear", { method: "POST" });
            loadLogsHistory();
        } catch (err) {
            showToast("Erreur réseau.", "error");
        }
    }

    function setupPolling() {
        // Prevent multiple intervals
        if (state.isPollingActive) return;
        state.isPollingActive = true;

        state.pollingInterval = setInterval(async () => {
            await refreshGlobalStatus();
            if (state.currentView === "config") {
                await loadLogsHistory();
            }
        }, 3000);
        
        // Load initial settings parameters
        loadGeneralSettings();
    }

    // -------------------------------------------------------------
    // UTILS
    // -------------------------------------------------------------
    function formatCurrency(amount) {
        return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
    }

    function showToast(message, type = "success") {
        const container = document.getElementById("alert-container");
        const toast = document.createElement("div");
        toast.className = `alert-toast ${type}`;
        
        const icons = {
            success: "fa-circle-check",
            error: "fa-triangle-exclamation",
            info: "fa-circle-info"
        };
        const icon = icons[type] || "fa-circle-info";

        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${escapeHTML(message)}</span>
        `;
        container.appendChild(toast);

        // Slide out and remove toast after 4 seconds
        setTimeout(() => {
            toast.style.animation = "slideIn 0.3s reverse forwards";
            toast.addEventListener("animationend", () => toast.remove());
        }, 4000);
    }

    function escapeHTML(str) {
        if (!str) return "";
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function populateImportAccountsSelector() {
        const select = document.getElementById("import-account-id");
        if (!select) return;
        
        const sortedAccs = [...state.accounts].sort((a, b) => (a.label || "").localeCompare(b.label || "", 'fr'));
        
        let html = `<option value="auto_ofx" selected>Détecter automatiquement (depuis le fichier OFX)</option>`;
        
        html += sortedAccs.map(acc => 
            `<option value="${escapeHTML(acc.id)}">${escapeHTML(acc.label)} (${escapeHTML(acc.bank_name || 'Manuel')})</option>`
        ).join("");
        
        html += `<option value="__new_manual__">+ Créer un nouveau compte manuel...</option>`;
        select.innerHTML = html;
        select.dispatchEvent(new Event("change"));
    }

    async function handleImportSubmit(e) {
        e.preventDefault();
        let accountId = document.getElementById("import-account-id").value;
        const fileInput = document.getElementById("import-file");
        
        if (!accountId) {
            showToast("Veuillez sélectionner un compte.", "error");
            return;
        }
        if (!fileInput.files || fileInput.files.length === 0) {
            showToast("Veuillez sélectionner un fichier.", "error");
            return;
        }
        
        const btnSubmit = document.getElementById("btn-submit-import");
        const originalText = btnSubmit.innerText;
        btnSubmit.disabled = true;
        
        try {
            // 1. Create manual account first if required
            if (accountId === "__new_manual__") {
                btnSubmit.innerText = "Création du compte...";
                const newId = document.getElementById("import-new-account-id").value.trim();
                const newLabel = document.getElementById("import-new-account-label").value.trim();
                const newType = document.getElementById("import-new-account-type").value;
                const newBalance = parseFloat(document.getElementById("import-new-account-balance").value) || 0.0;
                
                if (!newId || !newLabel) {
                    showToast("Veuillez remplir les informations du nouveau compte.", "error");
                    btnSubmit.disabled = false;
                    btnSubmit.innerText = originalText;
                    return;
                }
                
                const createRes = await fetch("/api/accounts/manual", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: newId, label: newLabel, type: newType, balance: newBalance })
                });
                
                if (!createRes.ok) {
                    const errData = await createRes.json();
                    showToast(errData.detail || "Erreur lors de la création du compte manuel.", "error");
                    btnSubmit.disabled = false;
                    btnSubmit.innerText = originalText;
                    return;
                }
                
                accountId = newId; // Use newly created account ID for import
            }
            
            // 2. Upload file
            btnSubmit.innerText = "Importation...";
            const file = fileInput.files[0];
            const formData = new FormData();
            formData.append("account_id", accountId);
            formData.append("file", file);
            
            const res = await fetch("/api/transactions/import", {
                method: "POST",
                body: formData
            });
            
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, "success");
                document.getElementById("modal-import").classList.add("hidden");
                document.getElementById("form-import-transactions").reset();
                loadAllData(); // Reload all data to refresh charts and table
            } else {
                showToast(data.detail || "Erreur lors de l'importation.", "error");
            }
        } catch (err) {
            console.error("Import error:", err);
            showToast("Erreur réseau lors de l'importation.", "error");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerText = originalText;
        }
    }

    function openSplitModal(t) {
        state.currentSplitTx = t;
        document.getElementById("split-tx-id").value = t.id;
        
        // Render summary
        const summaryDiv = document.getElementById("split-tx-summary");
        const formattedAmt = (t.amount >= 0 ? "+" : "") + formatCurrency(t.amount);
        const amountClass = t.amount >= 0 ? "green-text" : "red-text";
        summaryDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <strong>${escapeHTML(t.label)}</strong>
                <span class="${amountClass}"><strong>${formattedAmt}</strong></span>
            </div>
            <div style="font-size: 0.8rem; color: rgba(255,255,255,0.6);">
                Date: ${escapeHTML(t.date)} | Compte: ${escapeHTML(t.account_label || 'Inconnu')}
            </div>
        `;
        
        // Reset container
        const container = document.getElementById("split-parts-container");
        container.innerHTML = "";
        
        // Add 2 parts by default with divided amount
        const partAmt = parseFloat((t.amount / 2).toFixed(2));
        const diffAmt = parseFloat((t.amount - (partAmt * 2)).toFixed(2));
        
        addSplitPartRow(partAmt + diffAmt, t.category, t.note || "");
        addSplitPartRow(partAmt, "", t.note || "");
        
        recalculateSplitSums();
        document.getElementById("modal-split-transaction").classList.remove("hidden");
    }

    function addSplitPartRow(amount = 0.0, category = "", note = "") {
        const container = document.getElementById("split-parts-container");
        const rowId = "split-part-row-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
        
        // Sort and filter categories for dropdown
        const sortedCategories = [...state.categories].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        const filteredCategories = sortedCategories.filter(c => {
            if (category && c.name === category) return true;
            if (c.type === "Transfert" || c.name.toLowerCase() === "transfert") return true;
            if (state.currentSplitTx.amount >= 0) {
                return c.type === "Revenu";
            } else {
                return c.type === "Dépense fixe" || c.type === "Dépense variable";
            }
        });
        
        const catOptions = filteredCategories.map(c => 
            `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`
        ).join("");
        
        const rowDiv = document.createElement("div");
        rowDiv.id = rowId;
        rowDiv.className = "split-part-row";
        rowDiv.style = "display: flex; gap: 10px; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;";
        rowDiv.innerHTML = `
            <div style="flex: 1;">
                <label style="font-size: 0.75rem; color: rgba(255,255,255,0.5); display: block; margin-bottom: 3px;">Montant (€)</label>
                <input type="number" class="table-input-note split-part-amount" step="0.01" value="${amount.toFixed(2)}" style="width: 100%; border: 1px solid rgba(255,255,255,0.1); padding: 5px; border-radius: 4px;" required>
            </div>
            <div style="flex: 1.5;">
                <label style="font-size: 0.75rem; color: rgba(255,255,255,0.5); display: block; margin-bottom: 3px;">Catégorie</label>
                <select class="table-select split-part-category" style="width: 100%; border: 1px solid rgba(255,255,255,0.1); padding: 5px; border-radius: 4px;">
                    <option value="">-- Catégorie --</option>
                    ${catOptions}
                </select>
            </div>
            <div style="flex: 2;">
                <label style="font-size: 0.75rem; color: rgba(255,255,255,0.5); display: block; margin-bottom: 3px;">Note</label>
                <input type="text" class="table-input-note split-part-note" value="${escapeHTML(note)}" placeholder="Note pour cette part..." style="width: 100%; border: 1px solid rgba(255,255,255,0.1); padding: 5px; border-radius: 4px;">
            </div>
            <div style="margin-top: 15px;">
                <button type="button" class="btn btn-secondary btn-sm btn-remove-split-part" style="padding: 5px 8px; color: #ef4444;" title="Supprimer cette part">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        
        container.appendChild(rowDiv);
        
        // Select matching category
        if (category) {
            rowDiv.querySelector(".split-part-category").value = category;
        }
        
        // Attach change listeners
        rowDiv.querySelector(".split-part-amount").addEventListener("input", recalculateSplitSums);
        rowDiv.querySelector(".btn-remove-split-part").addEventListener("click", () => {
            // Require at least 2 parts
            if (document.querySelectorAll(".split-part-row").length <= 2) {
                showToast("Une transaction scindée doit comporter au moins 2 parts.", "error");
                return;
            }
            rowDiv.remove();
            recalculateSplitSums();
        });
    }

    function recalculateSplitSums() {
        if (!state.currentSplitTx) return;
        const totalAmount = state.currentSplitTx.amount;
        
        let sum = 0.0;
        document.querySelectorAll(".split-part-row").forEach(row => {
            sum += parseFloat(row.querySelector(".split-part-amount").value) || 0.0;
        });
        
        sum = parseFloat(sum.toFixed(2));
        const remaining = parseFloat((totalAmount - sum).toFixed(2));
        
        document.getElementById("split-total-parts-display").innerText = formatCurrency(sum);
        
        const remainingDisplay = document.getElementById("split-remaining-display");
        remainingDisplay.innerText = formatCurrency(remaining);
        
        const btnSubmit = document.getElementById("btn-submit-split");
        
        if (Math.abs(remaining) < 0.01) {
            remainingDisplay.style.color = "#10b981"; // Green
            btnSubmit.disabled = false;
        } else {
            remainingDisplay.style.color = "#ef4444"; // Red
            btnSubmit.disabled = true;
        }
    }

    async function handleSplitSubmit(e) {
        e.preventDefault();
        if (!state.currentSplitTx) return;
        
        const parts = [];
        document.querySelectorAll(".split-part-row").forEach(row => {
            parts.push({
                amount: parseFloat(row.querySelector(".split-part-amount").value) || 0.0,
                category: row.querySelector(".split-part-category").value || null,
                note: row.querySelector(".split-part-note").value.trim() || null
            });
        });
        
        const btnSubmit = document.getElementById("btn-submit-split");
        const origText = btnSubmit.innerText;
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Enregistrement...";
        
        try {
            const res = await fetch("/api/transactions/split", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    transaction_id: state.currentSplitTx.id,
                    parts: parts
                })
            });
            
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, "success");
                document.getElementById("modal-split-transaction").classList.add("hidden");
                loadAllData();
            } else {
                showToast(data.detail || "Erreur lors de la scission.", "error");
            }
        } catch (err) {
            console.error("Split submit error:", err);
            showToast("Erreur réseau.", "error");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerText = origText;
        }
    }

    // -------------------------------------------------------------
    // MANUAL TRANSACTIONS LOGIC
    // -------------------------------------------------------------
    function openAddTransactionModal() {
        const modal = document.getElementById("modal-add-transaction");
        const form = document.getElementById("form-add-transaction");
        form.reset();
        
        // Populate accounts selector
        const accSelect = document.getElementById("add-tx-account");
        const sortedAccs = [...state.accounts].sort((a, b) => (a.label || "").localeCompare(b.label || "", 'fr'));
        
        // If filter has an active account selected, use it by default
        const activeFilterAcc = state.txFilters.account_id;
        
        accSelect.innerHTML = sortedAccs.map(acc => {
            const isSelected = activeFilterAcc && acc.id === activeFilterAcc ? "selected" : "";
            return `<option value="${escapeHTML(acc.id)}" ${isSelected}>${escapeHTML(acc.label)}</option>`;
        }).join("");
        
        // Set date to today (YYYY-MM-DD)
        const dateInput = document.getElementById("add-tx-date");
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        dateInput.value = `${year}-${month}-${day}`;
        
        // Update category selector
        updateAddTransactionCategories();
        
        modal.classList.remove("hidden");
    }

    function updateAddTransactionCategories() {
        const catSelect = document.getElementById("add-tx-category");
        const flowType = document.getElementById("add-tx-flow-type")?.value || "expense";
        if (!catSelect) return;
        
        const sortedCategories = [...state.categories].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        
        const filtered = sortedCategories.filter(c => {
            if (c.type === "Transfert" || c.name.toLowerCase() === "transfert") return true;
            if (flowType === "income") return c.type === "Revenu";
            return c.type === "Dépense fixe" || c.type === "Dépense variable";
        });
        
        catSelect.innerHTML = `<option value="">-- Automatique --</option>` + filtered.map(c => 
            `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)} (${escapeHTML(c.type)})</option>`
        ).join("");
    }

    async function handleAddTransactionSubmit(e) {
        e.preventDefault();
        const accountId = document.getElementById("add-tx-account").value;
        const date = document.getElementById("add-tx-date").value;
        const flowType = document.getElementById("add-tx-flow-type").value;
        const rawAmount = parseFloat(document.getElementById("add-tx-amount").value);
        const label = document.getElementById("add-tx-label").value.trim();
        const category = document.getElementById("add-tx-category").value;
        const note = document.getElementById("add-tx-note").value.trim();
        const checked = document.getElementById("add-tx-checked").checked;
        const decalage = document.getElementById("add-tx-decalage").checked;
        
        if (!accountId || !date || !label || isNaN(rawAmount) || rawAmount <= 0) {
            showToast("Veuillez remplir tous les champs obligatoires avec des valeurs valides.", "error");
            return;
        }
        
        const finalAmount = flowType === "expense" ? -Math.abs(rawAmount) : Math.abs(rawAmount);
        
        const btnSubmit = document.getElementById("btn-submit-add-tx");
        const originalText = btnSubmit.innerHTML;
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement...`;
        
        try {
            const res = await fetch("/api/transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    account_id: accountId,
                    date: date,
                    label: label,
                    amount: finalAmount,
                    category: category || null,
                    note: note,
                    checked: checked,
                    decalage: decalage
                })
            });
            
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || "Transaction ajoutée avec succès !", "success");
                document.getElementById("modal-add-transaction").classList.add("hidden");
                document.getElementById("form-add-transaction").reset();
                await loadAllData();
            } else {
                showToast(data.detail || "Erreur lors de l'ajout de la transaction.", "error");
            }
        } catch (err) {
            console.error("Error creating transaction:", err);
            showToast("Erreur réseau lors de l'ajout de la transaction.", "error");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalText;
        }
    }

    async function deleteTransaction(transactionId) {
        if (!confirm("Voulez-vous vraiment supprimer cette transaction ? Cette action est irréversible.")) {
            return;
        }
        
        try {
            const res = await fetch(`/api/transactions/${transactionId}`, {
                method: "DELETE"
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || "Transaction supprimée.", "success");
                await loadAllData();
            } else {
                showToast(data.detail || "Erreur lors de la suppression.", "error");
            }
        } catch (err) {
            console.error("Delete error:", err);
            showToast("Erreur réseau lors de la suppression.", "error");
        }
    }
});
