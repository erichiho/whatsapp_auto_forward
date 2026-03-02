from calendar import weekday
import pandas as pd
import json
import requests
from datetime import date, timedelta, datetime
from requests.auth import HTTPBasicAuth
from workalendar.asia import HongKong

cal = HongKong()
headers = {
    "authorization": "8db7e4e9-d516-11ee-8d7a-fa163e1111b9"
}
today = date.today()

page = 1
response = requests.get(url=f"https://digitallogbooks.emsd.gov.hk/api/public/recentJobRecord?date_from={today-timedelta(days=60)}&date_to={today}&page={page}&client_id=ORG1587", headers=headers)


print(response.json()["data"])


all_breakdown = []
callReceiveTime = []
arrivalTime = []
time_required = []
equipment_no = []
chineseAddress = []
locationID = []
late = []
content = []
breakdown = {"Venue": chineseAddress,"Equip No": equipment_no, "LocationID": locationID, "Call Time": callReceiveTime, "Arr Time": arrivalTime, "Time Req": time_required, "Late": late, "Content": content}


print(f"Total pages is {response.json()["totalPages"]}")
print(f"Size per page is {response.json()["sizePerPage"]}")

totalPages = response.json()["totalPages"]
sizePerPage = response.json()["sizePerPage"]

def check_late(weekday, t, trap, hr_call, year_call, month_call, day_call):
    if trap == "TW02": # trapped case
        if (weekday >= 0 and weekday <= 5) and (hr_call >=9 and hr_call <= 17) and t > 20 and cal.is_working_day(date(year_call, month_call, day_call)):
            return True
        elif t > 60:
            return True
        else:
            return False
    elif trap == "TW01": # non trapped case
        if (weekday >= 0 and weekday <= 5) and (hr_call >=9 and hr_call <= 17) and t > 30 and cal.is_working_day(date(year_call, month_call, day_call)):
            return True
        elif t > 60:
            return True
        else:
            return False

# cal = HongKong()
# print(cal.holidays(2024))
# if cal.is_holiday(date(2024,12,25)):
#     print("It is a holiday")

for page in range(1,totalPages):
    response = requests.get(url=f"https://digitallogbooks.emsd.gov.hk/api/public/recentJobRecord?date_from={today-timedelta(days=60)}&date_to={today}&page={page}&client_id=ORG1587", headers=headers)
    for item in range(sizePerPage):
        try:
            if response.json()["data"][item]["typesOfWorks"] == "TW01" or response.json()["data"][item]["typesOfWorks"] == "TW02":

                print(f"number {item} is a breakdown case")
                print(response.json()["data"][item]["callReceiveTime"])
                callReceiveTime.append(response.json()["data"][item]["callReceiveTime"])
                arrivalTime.append(response.json()["data"][item]["arrivalTime"])
                locationID.append(response.json()["data"][item]["relatedLogbooks"][0]["basicLogbookInfo"]["locationID"])
                hr_arr = int(response.json()["data"][item]["arrivalTime"][11:13])
                hr_call = int(response.json()["data"][item]["callReceiveTime"][11:13])
                year_call = int(response.json()["data"][item]["callReceiveTime"][0:4])
                month_call = int(response.json()["data"][item]["callReceiveTime"][5:7])
                day_call = int(response.json()["data"][item]["callReceiveTime"][8:10])
                weekday = datetime(year_call, month_call,day_call).weekday()
                t = int((hr_arr - hr_call) * 60) + int(response.json()["data"][item]["arrivalTime"][14:16]) - int(response.json()["data"][item]["callReceiveTime"][14:16])

                time_required.append(t)
                if check_late(weekday, t, response.json()["data"][item]["typesOfWorks"], hr_call, year_call, month_call, day_call) == True:
                    late.append("yes")
                else:
                    late.append("no")
                chineseAddress.append(response.json()["data"][item]["chineseAddress"])
                equipment_no.append(response.json()["data"][item]["relatedLogbooks"][0]["basicLogbookInfo"]["leType"] + response.json()["data"][item]["relatedLogbooks"][0]["basicLogbookInfo"]["leNumber"])
                content.append(response.json()["data"][item]["relatedLogbooks"][0]["remark"]["content"])
                #all_breakdown += breakdown["callReceiveTime"]
        except KeyError:
            pass
        print(response.json()["data"][item]["arrivalTime"])
        print(response.json()["data"][item]["chineseAddress"])
        print(response.json()["data"][item]["relatedLogbooks"][0]["basicLogbookInfo"]["locationID"])
        print(response.json()["data"][item]["relatedLogbooks"][0]["basicLogbookInfo"]["leType"] + response.json()["data"][0]["relatedLogbooks"][0]["basicLogbookInfo"]["leNumber"])
        try:
            print(response.json()["data"][item]["typesOfWorks"])
        except KeyError:
            print("Types of Works not available")
        try:
            print(response.json()["data"][item]["relatedLogbooks"][0]["remark"]["content"])
        except KeyError:
            print("Content not available")



print(f"all callReceiveTime is {callReceiveTime}")
print(f"all arrivalTime is {arrivalTime}")
print(f"all time required is {time_required}")
print(f"all address is {chineseAddress}")
print(f"all location ID is {locationID}")
print(f"all equipment number is {equipment_no}")
print(f"all content is {content}")

df = pd.DataFrame(breakdown)
print(df)

#Check repeated breakdowns
repeated_call = []
unique_list = list(set(locationID))
for j in unique_list:
    count = locationID.count(j)
    if count > 1:
        repeated_call.append(j)
        df_repeat = df[df.LocationID == j]
        df_repeat.to_csv(f"{j}.csv")

print(repeated_call)

df.to_csv("breakdown.csv")
