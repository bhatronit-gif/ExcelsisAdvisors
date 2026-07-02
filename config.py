# config.py

SCHOOLS = [
    "Children's Academy Bachani Nagar",
    "Children's Academy Ashok Nagar",
    "Children's Academy Thakur Complex",
    "Children's Academy Thane",
    "Aspee Nutan Academy"
]

# Weights are represented as decimals (10% = 0.10)
# Indicators hold their Phase 2 micro-multiplier (1, 2, or 3)
CATEGORIES = {
    "1. Infrastructure": {
        "weight": 0.10,
        "indicators": {
            "1.1 Classroom": 2, "1.2 Washroom": 2, "1.3 Drinking water facility": 3, "1.4 Laboratories": 2,
            "1.5 Ground Area": 2, "1.6 Art Room": 1, "1.7 Sports Room": 2, "1.8 Electric and Lift Room": 3,
            "1.9 Inventory Room": 1, "1.10 Pump Room": 3, "1.11 Server Room": 2, "1.12 Terrace": 1,
            "1.13 Printing Room": 1, "1.14 Library": 2, "1.15 Computer Room": 2, "1.16 Hall": 1,
            "1.17 Staff Room": 1, "1.18 Store Room": 1, "1.19 Activity Room": 1, "1.20 Sick Bay": 3,
            "1.21 Conference Room": 1, "1.22 Music Room": 1, "1.23 Peon Room": 1, "1.24 Reflection Room": 1,
            "1.25 Counselling Room": 2
        }
    },
    "2. Learning Environment": {
        "weight": 0.10,
        "indicators": {"2.1 Ventilation": 2, "2.2 Lighting": 2, "2.3 Furniture": 2, "2.4 Noise": 1}
    },
    "3. Safety & Security": {
        "weight": 0.15,
        "indicators": {
            "3.1 Firefighting readiness": 3, "3.2 Visitor entry procedures": 2,
            "3.3 Hazardous materials": 3, "3.4 Hobby classes protocols": 1,
            "3.5 Documentation of records": 2, "3.6 School CCTV Surveillance": 3,
            "3.7 Bus Safety Protocols & ARD AMC": 3
        }
    },
    "4. Health": {
        "weight": 0.10,
        "indicators": {"4.1 Health Check-up": 3, "4.2 Safe Water Provision": 3, "4.3 Documentation of Records": 1}
    },
    "5. Transport": {
        "weight": 0.10,
        "indicators": {"5.1 Bus Infrastructure": 2, "5.2 HR": 2, "5.3 Safety Protocols": 3}
    },
    "6. Canteen": {
        "weight": 0.05,
        "indicators": {"6.1 Canteen Infrastructure": 2, "6.2 Documentation of records": 1}
    },
    "7. Regulatory Compliance": {
        "weight": 0.15,
        "indicators": {"7.1 Teaching Staff": 3, "7.2 Non-Teaching Staff": 3, "7.3 Documentation of Records": 2, "7.4 HR": 2}
    },
    "8. Institutional Records": {
        "weight": 0.05,
        "indicators": {"8.1 Fees": 2, "8.2 Admissions/ LC": 2, "8.3 Inventory records": 1, "8.4 Documentation of records": 1}
    },
    "9. School Operations": {
        "weight": 0.15,
        "indicators": {"9.1 Examinations": 2, "9.2 Teaching Learning Process": 3, "9.3 Documentation of records": 3}
    },
    "10. Student & Staff Dev": {
        "weight": 0.05,
        "indicators": {
            "10.1 Events": 2, "10.2 Assembly": 1, "10.3 Achievements and Initiatives": 2,
            "10.4 Documentation of various committees": 1, "10.5 CARE Dept": 3
        }
    }
}
