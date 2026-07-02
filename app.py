# app.py
import streamlit as st
import pandas as pd
from datetime import date
from config import SCHOOLS, CATEGORIES

# --- 1. UI SETUP ---
st.set_page_config(page_title="Excelsis Audit Tool", layout="wide", page_icon="🏫")

# --- 2. SESSION STATE (Prevents data loss when switching tabs) ---
if 'audit_data' not in st.session_state:
    st.session_state['audit_data'] = {}
    for cat in CATEGORIES:
        st.session_state['audit_data'][cat] = {}
        for ind in CATEGORIES[cat]["indicators"]:
            st.session_state['audit_data'][cat][ind] = {
                "score": 3, "features": "", "gaps": "", "actions": ""
            }

st.title("🏫 Excelsis Advisors - Smart Audit App")
st.write("Fill out the audit below. Weightages are risk-adjusted automatically in the backend upon export.")

# Meta Info
with st.container():
    col1, col2, col3 = st.columns(3)
    with col1: selected_school = st.selectbox("Select School Campus", SCHOOLS)
    with col2: auditor = st.text_input("Auditor Name", placeholder="e.g., Rohit Bhat")
    with col3: audit_date = st.date_input("Audit Date", date.today())

st.divider()

# --- 3. AUDIT FORM (Tabs for categories) ---
tabs = st.tabs(list(CATEGORIES.keys()))

for i, (cat_name, cat_data) in enumerate(CATEGORIES.items()):
    with tabs[i]:
        st.subheader(f"Macro-Weight: {cat_data['weight']*100:.0f}% of Total Audit")
        
        for ind_name, multiplier in cat_data['indicators'].items():
            with st.expander(f"{ind_name} (Risk Multiplier: {multiplier}x)", expanded=False):
                
                # Fetch current values from session state to persist them
                curr_data = st.session_state['audit_data'][cat_name][ind_name]
                
                c_score, c_feat, c_gap, c_act = st.columns([1, 2, 2, 2])
                with c_score:
                    # Ranged 1 to 5 per your request. Using number_input is easier for touch screens.
                    new_score = st.number_input("Score (1-5)", min_value=1, max_value=5, value=curr_data["score"], key=f"score_{cat_name}_{ind_name}")
                with c_feat:
                    new_feat = st.text_area("Notable Features", curr_data["features"], key=f"feat_{cat_name}_{ind_name}", height=100)
                with c_gap:
                    new_gap = st.text_area("Gaps Identified 🚩", curr_data["gaps"], key=f"gap_{cat_name}_{ind_name}", height=100)
                with c_act:
                    new_act = st.text_area("Actions Recommended 🛠", curr_data["actions"], key=f"act_{cat_name}_{ind_name}", height=100)
                
                # Update session state with any changes instantly
                st.session_state['audit_data'][cat_name][ind_name] = {
                    "score": new_score, "features": new_feat, "gaps": new_gap, "actions": new_act
                }

st.divider()

# --- 4. EXPORT & CALCULATION ENGINE ---
if st.button("💾 Calculate & Export Audit File", type="primary", use_container_width=True):
    report_rows = []
    final_weighted_score = 0
    
    for cat_name, cat_data in CATEGORIES.items():
        cat_earned, cat_max = 0, 0
        
        for ind_name, multiplier in cat_data['indicators'].items():
            data = st.session_state['audit_data'][cat_name][ind_name]
            score = data['score']
            
            # Applying Micro-Weightage (Phase 2)
            cat_earned += (score * multiplier)
            cat_max += (5 * multiplier) 
            
            report_rows.append({
                "School": selected_school,
                "Auditor": auditor,
                "Date": audit_date,
                "Category": cat_name,
                "Indicator": ind_name,
                "Risk Multiplier": f"{multiplier}x",
                "Score": score,
                "Notable Features": data['features'],
                "Gaps Identified": data['gaps'],
                "Actions Recommended": data['actions']
            })
            
        # Applying Macro-Weightage (Phase 1)
        if cat_max > 0:
            cat_percentage = cat_earned / cat_max
            final_weighted_score += (cat_percentage * cat_data['weight'])
            
    # Generate CSV file in memory
    df = pd.DataFrame(report_rows)
    csv_data = df.to_csv(index=False).encode('utf-8')
    
    st.success(f"Audit calculated! Final Risk-Adjusted Score: **{final_weighted_score * 100:.2f}%**")
    
    st.download_button(
        label="📥 Download Audit Data (CSV / Excel)",
        data=csv_data,
        file_name=f"Excelsis_Audit_{selected_school.replace(' ', '_')}_{audit_date}.csv",
        mime="text/csv",
        use_container_width=True
    )
