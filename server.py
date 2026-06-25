import asyncio
import json
import logging
import os
import random
from datetime import datetime
from typing import Set

import requests
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("TwitchFishing")

app = FastAPI(title="Twitch Fishing Game")

CONFIG_FILE = "config.json"
DATABASE_FILE = "database.json"

# Rarity Color Codes (Hex) and Loot Table
FISH_LOOT_TABLE = {
    "trash": {
        "chance": 0.15,
        "color": "#9ca3af",  # Gray
        "title": "Хлам",
        "items": [
            {"name": "Старый башмак", "min_weight": 0.2, "max_weight": 1.0, "description": "Кто-то выбросил его давным-давно. Отлично пахнет водорослями!"},
            {"name": "Консервная банка", "min_weight": 0.1, "max_weight": 0.4, "description": "Пустая и ржавая. Внутри ничего нет, кроме воспоминаний."},
            {"name": "Пучок водорослей", "min_weight": 0.05, "max_weight": 0.3, "description": "Просто зеленые сопливые водоросли. Рыба сорвалась!"},
            {"name": "Пластиковый стаканчик", "min_weight": 0.01, "max_weight": 0.05, "description": "Пожалуйста, берегите природу! Не бросайте пластик в воду."}
        ]
    },
    "common": {
        "chance": 0.50,
        "color": "#10b981",  # Green
        "title": "Обычная рыба",
        "items": [
            {"name": "Карась", "min_weight": 0.15, "max_weight": 1.5, "description": "Классика рыбалки. Маленький, шустрый и серебристый!"},
            {"name": "Окунь", "min_weight": 0.1, "max_weight": 1.2, "description": "Полосатый хищник. Берегитесь острых плавников!"},
            {"name": "Плотва", "min_weight": 0.08, "max_weight": 0.6, "description": "Серебристая рыбка с красными плавниками. Кот будет доволен."},
            {"name": "Ерш", "min_weight": 0.03, "max_weight": 0.2, "description": "Маленький, колючий и очень сердитый!"}
        ]
    },
    "uncommon": {
        "chance": 0.20,
        "color": "#3b82f6",  # Blue
        "title": "Необычная рыба",
        "items": [
            {"name": "Лещ", "min_weight": 0.5, "max_weight": 4.0, "description": "Плоский как блин и скользкий как мыло. Хорош в сушеном виде!"},
            {"name": "Линь", "min_weight": 0.4, "max_weight": 3.0, "description": "Золотисто-зеленый красавец. Покрыт толстым слоем слизи."},
            {"name": "Судак", "min_weight": 0.8, "max_weight": 6.0, "description": "Клыкастый охотник глубин. Светится в темноте (почти)."}
        ]
    },
    "rare": {
        "chance": 0.10,
        "color": "#8b5cf6",  # Purple
        "title": "Редкая рыба",
        "items": [
            {"name": "Щука", "min_weight": 1.5, "max_weight": 12.0, "description": "Речной крокодил! Острые зубы и свирепый нрав."},
            {"name": "Карп", "min_weight": 2.0, "max_weight": 15.0, "description": "Упитанный и сильный боец. Сопротивлялся как мог!"},
            {"name": "Форель", "min_weight": 0.5, "max_weight": 5.0, "description": "Радужная красавица из чистых горных ручьев."},
            {"name": "Плеко", "min_weight": 0.1, "max_weight": 1.5, "description": "Прилипала! Присосался к вашему рту. Замучен на 10 минут!", "mute_duration": 600}
        ]
    },
    "epic": {
        "chance": 0.04,
        "color": "#ec4899",  # Pink/Magenta
        "title": "Эпическая рыба",
        "items": [
            {"name": "Лосось", "min_weight": 3.0, "max_weight": 20.0, "description": "Благородная рыба! Перепрыгнул через плотину прямо на твою удочку."},
            {"name": "Сом", "min_weight": 5.0, "max_weight": 70.0, "description": "Гигант омутов! С длинными усами. Может утащить на дно."},
            {"name": "Осетр", "min_weight": 4.0, "max_weight": 50.0, "description": "Царская рыба. Древний обитатель рек с костяными бляшками."}
        ]
    },
    "legendary": {
        "chance": 0.01,
        "color": "#fbbf24",  # Yellow/Gold
        "title": "ЛЕГЕНДАРНАЯ РЫБА",
        "items": [
            {"name": "Золотая рыбка", "min_weight": 0.1, "max_weight": 0.5, "description": "Исполняет три желания! Но стример заберет их себе."},
            {"name": "Кракен", "min_weight": 100.0, "max_weight": 1000.0, "description": "Легендарное чудовище бездны! Как ты вообще его вытащил?!"},
            {"name": "Царь-Рыба", "min_weight": 80.0, "max_weight": 400.0, "description": "Огромный осетр невероятных размеров. Рыба твоей мечты!"}
        ]
    },
    "roulette_mod": {
        "chance": 0.0,  # We don't roll this randomly; it's a specific reward
        "color": "#ef4444",  # Red
        "title": "Русская рулетка на Модера",
        "items": [
            {"name": "Модератор", "description": "Тебе повезло! Ты выиграл Модератора!", "mute_duration": 0},
            {"name": "Бан 3 часа", "description": "Не повезло! Бан на 3 часа!", "mute_duration": 10800} # 3 hours
        ]
    },
    "roulette_vip": {
         "chance": 0.0, # Specific reward
         "color": "#eab308", # Gold/Yellow
         "title": "Русская рулетка на VIP",
         "items": [
            {"name": "VIP", "description": "Тебе повезло! Ты выиграл VIP!", "mute_duration": 0},
            {"name": "Бан 3 часа", "description": "Не повезло! Бан на 3 часа!", "mute_duration": 10800} # 3 hours
        ]
    }
}

# Config Management
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading config: {e}")
    return {
        "client_id": "",
        "client_secret": "",
        "reward_title": "Рыбалка 🎣",
        "reward_cost": 100,
        "access_token": "",
        "refresh_token": "",
        "broadcaster_id": "",
        "broadcaster_name": "",
        "reward_id": "",
        "is_active": False
    }

def save_config(config):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving config: {e}")

# Database Management
def load_database():
    default_db = {"all_time": {"users": {}}, "session": {"users": {}, "history": []}}
    if os.path.exists(DATABASE_FILE):
        try:
            with open(DATABASE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "all_time" not in data:
                    # Migrate old DB
                    return {
                        "all_time": {"users": data.get("users", {})},
                        "session": {"users": data.get("users", {}), "history": data.get("history", [])}
                    }
                return data
        except Exception as e:
            logger.error(f"Error loading database: {e}")
    return default_db

def save_database(db):
    try:
        with open(DATABASE_FILE, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=4, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving database: {e}")

# Twitch API Helper functions
def twitch_api_headers(config):
    return {
        "Client-ID": config["client_id"],
        "Authorization": f"Bearer {config['access_token']}",
        "Content-Type": "application/json"
    }

def refresh_twitch_token(config):
    if not config.get("refresh_token") or not config.get("client_id") or not config.get("client_secret"):
        return False
    
    url = "https://id.twitch.tv/oauth2/token"
    payload = {
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "grant_type": "refresh_token",
        "refresh_token": config["refresh_token"]
    }
    
    try:
        response = requests.post(url, data=payload)
        if response.status_code == 200:
            data = response.json()
            config["access_token"] = data["access_token"]
            if "refresh_token" in data:
                config["refresh_token"] = data["refresh_token"]
            save_config(config)
            logger.info("Twitch OAuth token refreshed successfully.")
            return True
        else:
            logger.error(f"Failed to refresh Twitch token: {response.text}")
            return False
    except Exception as e:
        logger.error(f"Error refreshing Twitch token: {e}")
        return False

def make_twitch_request(method, url, config, **kwargs):
    """Wrapper that handles auto-refresh on 401"""
    headers = twitch_api_headers(config)
    if 'headers' in kwargs:
        headers.update(kwargs['headers'])
    kwargs['headers'] = headers
    
    try:
        response = requests.request(method, url, **kwargs)
        if response.status_code == 401:
            logger.info("Twitch API returned 401. Attempting to refresh token...")
            if refresh_twitch_token(config):
                # Retry request with new header
                kwargs['headers'] = twitch_api_headers(config)
                response = requests.request(method, url, **kwargs)
            else:
                logger.error("Token refresh failed. Cannot retry request.")
        return response
    except Exception as e:
        logger.error(f"Error making Twitch request to {url}: {e}")
        return None

def check_and_create_custom_reward(config, title_key="reward_title", cost_key="reward_cost", prompt="Попробуй поймать рыбу! Какую редкость ты вытащишь?", reward_id_key="reward_id"):
    if not config.get("broadcaster_id"):
        return False
        
    broadcaster_id = config["broadcaster_id"]
    reward_title = config.get(title_key, "Рыбалка 🎣")
    reward_cost = config.get(cost_key, 100)
    
    # 1. List existing custom rewards
    url = f"https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id={broadcaster_id}"
    res = make_twitch_request("GET", url, config)
    if res and res.status_code == 200:
        rewards = res.json().get("data", [])
        for r in rewards:
            if r["title"].lower() == reward_title.lower():
                config[reward_id_key] = r["id"]
                save_config(config)
                logger.info(f"Found existing reward '{reward_title}' with ID: {r['id']}")
                
                # Update status
                is_paused = not config.get("is_active", False)
                if r["is_paused"] != is_paused or not r["is_enabled"] or r["cost"] != int(reward_cost):
                    update_custom_reward_status(config, is_paused, reward_id_key=reward_id_key, cost_key=cost_key)
                return True
                
        # 2. If not found, create it
        create_url = f"https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id={broadcaster_id}"
        payload = {
            "title": reward_title,
            "cost": int(reward_cost),
            "prompt": prompt,
            "is_enabled": True,
            "is_paused": not config.get("is_active", False)
        }
        create_res = make_twitch_request("POST", create_url, config, json=payload)
        if create_res and create_res.status_code == 200:
            new_r = create_res.json()["data"][0]
            config[reward_id_key] = new_r["id"]
            save_config(config)
            logger.info(f"Created new custom reward '{reward_title}' with ID: {new_r['id']}")
            return True
        else:
            err_msg = create_res.text if create_res else "No response"
            logger.error(f"Failed to create custom reward: {err_msg}")
            return False
    else:
        err_msg = res.text if res else "No response"
        logger.error(f"Failed to fetch custom rewards: {err_msg}")
        return False

def update_custom_reward_status(config, is_paused: bool, reward_id_key="reward_id", cost_key="reward_cost"):
    broadcaster_id = config.get("broadcaster_id")
    reward_id = config.get(reward_id_key)
    reward_cost = config.get(cost_key, 100)
    if not broadcaster_id or not reward_id:
        return
        
    url = f"https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id={broadcaster_id}&id={reward_id}"
    payload = {
        "is_paused": is_paused,
        "is_enabled": True,
        "cost": int(reward_cost)
    }
    res = make_twitch_request("PATCH", url, config, json=payload)
    if res and res.status_code == 200:
        logger.info(f"Custom reward state updated: paused={is_paused}, cost={reward_cost}")
    else:
        err_msg = res.text if res else "No response"
        logger.error(f"Failed to update custom reward status: {err_msg}")

def subscribe_to_eventsub(config, session_id):
    if not config.get("broadcaster_id") or not session_id:
        return False
        
    url = "https://api.twitch.tv/helix/eventsub/subscriptions"
    payload = {
        "type": "channel.channel_points_custom_reward_redemption.add",
        "version": "1",
        "condition": {
            "broadcaster_user_id": config["broadcaster_id"]
        },
        "transport": {
            "method": "websocket",
            "session_id": session_id
        }
    }
    
    res = make_twitch_request("POST", url, config, json=payload)
    if res and res.status_code in (200, 202):
        logger.info("Successfully subscribed to channel point redemptions EventSub!")
        return True
    else:
        err_msg = res.text if res else "No response"
        logger.error(f"Failed to subscribe to EventSub: {err_msg}")
        return False

def fulfill_redemption(config, redemption_id, reward_id):
    broadcaster_id = config.get("broadcaster_id")
    if not broadcaster_id:
        return
    url = f"https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id={broadcaster_id}&id={redemption_id}&reward_id={reward_id}"
    payload = {
        "status": "FULFILLED"
    }
    res = make_twitch_request("PATCH", url, config, json=payload)
    if res and res.status_code == 200:
        logger.info(f"Redemption {redemption_id} fulfilled successfully.")
    else:
        err_msg = res.text if res else "No response"
        logger.error(f"Failed to fulfill redemption {redemption_id}: {err_msg}")

def timeout_user(config, user_id, duration_seconds=600, reason="Поймал рыбу Плеко! 🐟"):
    broadcaster_id = config.get("broadcaster_id")
    if not broadcaster_id:
        return False
    
    url = f"https://api.twitch.tv/helix/moderation/bans?broadcaster_id={broadcaster_id}&moderator_id={broadcaster_id}"
    payload = {
        "data": {
            "user_id": user_id,
            "duration": duration_seconds,
            "reason": reason
        }
    }
    
    res = make_twitch_request("POST", url, config, json=payload)
    if res and res.status_code == 200:
        logger.info(f"Successfully timed out user {user_id} for {duration_seconds} seconds.")
        return True
    else:
        err_msg = res.text if res else "No response"
        logger.error(f"Failed to timeout user {user_id}: {err_msg}")
        return False

# WebSocket connection pool
active_connections: Set[WebSocket] = set()

async def broadcast_message(message: dict):
    if not active_connections:
        return
    payload = json.dumps(message, ensure_ascii=False)
    dead_connections = []
    for ws in active_connections:
        try:
            await ws.send_text(payload)
        except Exception:
            dead_connections.append(ws)
            
    for ws in dead_connections:
        active_connections.remove(ws)

# Fishing Simulation Logic
def choose_catch(roulette_type: str = None):
    if roulette_type and roulette_type in FISH_LOOT_TABLE:
        selected_rarity = roulette_type
        rarity_data = FISH_LOOT_TABLE[selected_rarity]
        item = random.choice(rarity_data["items"])
        weight = 0.0 # Roulette rewards don't have weight
    else:
        rarity_chances = [
            ("trash", 0.15),
            ("common", 0.50),
            ("uncommon", 0.20),
            ("rare", 0.10),
            ("epic", 0.04),
            ("legendary", 0.01)
        ]
        
        r = random.random()
        cumulative = 0.0
        selected_rarity = "common"
        for rarity, chance in rarity_chances:
            cumulative += chance
            if r <= cumulative:
                selected_rarity = rarity
                break
                
        rarity_data = FISH_LOOT_TABLE[selected_rarity]
        item = random.choice(rarity_data["items"])
        
        weight = random.uniform(item["min_weight"], item["max_weight"])
        weight = round(weight, 2)
    
    return {
        "name": item["name"],
        "weight": weight,
        "rarity": selected_rarity,
        "rarity_title": rarity_data["title"],
        "color": rarity_data["color"],
        "description": item["description"],
        "mute_duration": item.get("mute_duration", 0)
    }

def register_catch(username, display_name, fish):
    db = load_database()
    
    def update_user_stats(user_dict):
        if username not in user_dict:
            user_dict[username] = {
                "username": username,
                "display_name": display_name,
                "total_fish": 0,
                "total_weight": 0.0,
                "biggest_fish": None
            }
        user = user_dict[username]
        user["total_fish"] += 1
        user["total_weight"] = round(user["total_weight"] + fish["weight"], 2)
        if not user["biggest_fish"] or fish["weight"] > user["biggest_fish"]["weight"]:
            user["biggest_fish"] = {
                "name": fish["name"],
                "weight": fish["weight"],
                "rarity": fish["rarity"],
                "timestamp": datetime.now().isoformat()
            }
        return user

    # Update both DB parts
    all_time_user = update_user_stats(db["all_time"]["users"])
    session_user = update_user_stats(db["session"]["users"])
        
    # Record to history log
    history = db["session"].get("history", [])
    history_entry = {
        "username": username,
        "display_name": display_name,
        "fish_name": fish["name"],
        "weight": fish["weight"],
        "rarity": fish["rarity"],
        "rarity_title": fish["rarity_title"],
        "color": fish["color"],
        "timestamp": datetime.now().isoformat()
    }
    history.insert(0, history_entry)
    db["session"]["history"] = history[:100]  # keep last 100 entries
    
    save_database(db)
    return session_user

# EventSub WebSocket Listener background loop
eventsub_task_ref = None

async def start_eventsub():
    global eventsub_task_ref
    config = load_config()
    if not config.get("is_active"):
        logger.info("EventSub is disabled in config, not starting.")
        return
        
    if eventsub_task_ref and not eventsub_task_ref.done():
        logger.info("EventSub listener is already running.")
        return
        
    logger.info("Starting EventSub WebSocket listener task...")
    eventsub_task_ref = asyncio.create_task(eventsub_websocket_loop())

async def stop_eventsub():
    global eventsub_task_ref
    if eventsub_task_ref and not eventsub_task_ref.done():
        logger.info("Stopping EventSub WebSocket listener...")
        eventsub_task_ref.cancel()
        try:
            await eventsub_task_ref
        except asyncio.CancelledError:
            pass
        eventsub_task_ref = None
        logger.info("EventSub WebSocket listener stopped.")

async def eventsub_websocket_loop():
    uri = "wss://eventsub.wss.twitch.tv/ws"
    
    while True:
        try:
            config = load_config()
            if not config.get("is_active"):
                logger.info("EventSub marked inactive, stopping loop.")
                break
                
            logger.info(f"Connecting to Twitch EventSub WS: {uri}")
            async with websockets.connect(uri) as websocket:
                async for message in websocket:
                    data = json.loads(message)
                    message_type = data.get("metadata", {}).get("message_type")
                    
                    if message_type == "session_welcome":
                        session_id = data["payload"]["session"]["id"]
                        logger.info(f"Received session_welcome. Session ID: {session_id}")
                        
                        # Subscribe via REST API
                        success = subscribe_to_eventsub(config, session_id)
                        if success:
                            logger.info("Successfully subscribed to redemptions EventSub!")
                        else:
                            logger.error("Failed to subscribe to EventSub.")
                            
                    elif message_type == "notification":
                        payload = data.get("payload", {})
                        event_type = payload.get("subscription", {}).get("type")
                        
                        if event_type == "channel.channel_points_custom_reward_redemption.add":
                            event = payload.get("event", {})
                            reward_id = event.get("reward", {}).get("id")
                            
                            # Double check reward ID match
                            if reward_id == config.get("reward_id"):
                                username = event.get("user_login")
                                display_name = event.get("user_name")
                                redemption_id = event.get("id")
                                
                                logger.info(f"Fishing reward redeemed by {display_name} ({username})")
                                
                                # Process game catch
                                fish = choose_catch()
                                user_stats = register_catch(username, display_name, fish)
                                
                                # Broadcast catch to all web widgets
                                await broadcast_message({
                                    "type": "catch",
                                    "user": {
                                        "username": username,
                                        "display_name": display_name
                                    },
                                    "fish": fish,
                                    "stats": {
                                        "total_fish": user_stats["total_fish"],
                                        "total_weight": user_stats["total_weight"],
                                        "biggest_fish_weight": user_stats["biggest_fish"]["weight"] if user_stats["biggest_fish"] else 0.0,
                                        "biggest_fish_name": user_stats["biggest_fish"]["name"] if user_stats["biggest_fish"] else ""
                                    }
                                })

                                # If the fish has a mute duration, timeout the user
                                if fish.get("mute_duration"):
                                    user_id = event.get("user_id")
                                    if user_id:
                                        logger.info(f"Timing out {display_name} ({username}) for {fish['mute_duration']}s because they caught {fish['name']}")
                                        asyncio.create_task(
                                            asyncio.to_thread(
                                                timeout_user,
                                                config,
                                                user_id,
                                                fish["mute_duration"],
                                                f"Поймал рыбу {fish['name']}! 🐟"
                                            )
                                        )
                                
                                # Fulfill on twitch
                                asyncio.create_task(
                                    asyncio.to_thread(fulfill_redemption, config, redemption_id, reward_id)
                                )
                                
                    elif message_type == "session_keepalive":
                        pass
                        
                    elif message_type == "session_reconnect":
                        reconnect_url = data["payload"]["session"]["reconnect_url"]
                        logger.info(f"Twitch requests reconnect to: {reconnect_url}")
                        uri = reconnect_url
                        break
                        
        except asyncio.CancelledError:
            logger.info("EventSub connection cancelled.")
            break
        except Exception as e:
            logger.error(f"Error in EventSub connection: {e}")
            uri = "wss://eventsub.wss.twitch.tv/ws"
            logger.info("Reconnecting to EventSub in 5 seconds...")
            await asyncio.sleep(5)

# API endpoints
@app.get("/api/status")
def get_status():
    config = load_config()
    is_running = eventsub_task_ref is not None and not eventsub_task_ref.done()
    return {
        "configured": bool(config.get("client_id") and config.get("client_secret")),
        "connected": bool(config.get("access_token")),
        "broadcaster_name": config.get("broadcaster_name", ""),
        "reward_title": config.get("reward_title", "Рыбалка 🎣"),
        "reward_cost": config.get("reward_cost", 100),
        "is_active": config.get("is_active", False),
        "eventsub_connected": is_running
    }

class SettingsModel(BaseModel):
    client_id: str
    client_secret: str
    reward_title: str
    reward_cost: int

@app.post("/api/settings")
def post_settings(settings: SettingsModel):
    config = load_config()
    title_changed = (config.get("reward_title") != settings.reward_title)
    
    config["client_id"] = settings.client_id
    config["client_secret"] = settings.client_secret
    config["reward_title"] = settings.reward_title
    config["reward_cost"] = settings.reward_cost
    
    if title_changed:
        config["reward_id"] = ""  # Force recreation on next activate
        
    save_config(config)
    return {"status": "ok"}

class ToggleModel(BaseModel):
    is_active: bool

@app.post("/api/toggle")
async def post_toggle(payload: ToggleModel):
    config = load_config()
    if not config.get("access_token"):
        raise HTTPException(status_code=400, detail="Не авторизован в Twitch. Пожалуйста, авторизуйтесь.")
        
    config["is_active"] = payload.is_active
    save_config(config)
    
    if payload.is_active:
        # Check and create reward on Twitch
        success = await asyncio.to_thread(check_and_create_custom_reward, config)
        if not success:
            config["is_active"] = False
            save_config(config)
            raise HTTPException(
                status_code=500,
                detail="Не удалось создать/активировать награду в Twitch. Проверьте Client ID / Secret."
            )
        # Start listening
        await start_eventsub()
    else:
        # Pause reward
        await asyncio.to_thread(update_custom_reward_status, config, is_paused=True)
        # Stop listening
        await stop_eventsub()
        
    return {"status": "ok", "is_active": config["is_active"]}

@app.get("/api/leaderboard")
def get_leaderboard(type: str = "session"):
    db = load_database()
    
    # fallback if wrong type
    if type not in ["session", "all_time"]:
        type = "session"
        
    users_data = db[type]["users"] if type in db else {}
    users = list(users_data.values())
    
    # Sort different leaderboards
    by_caught = sorted(users, key=lambda x: x["total_fish"], reverse=True)[:10]
    by_weight = sorted(users, key=lambda x: x["total_weight"], reverse=True)[:10]
    
    users_with_biggest = [u for u in users if u.get("biggest_fish")]
    by_biggest = sorted(users_with_biggest, key=lambda x: x["biggest_fish"]["weight"], reverse=True)[:10]
    
    return {
        "by_caught": [
            {
                "display_name": u["display_name"],
                "username": u["username"],
                "score": u["total_fish"]
            } for u in by_caught
        ],
        "by_weight": [
            {
                "display_name": u["display_name"],
                "username": u["username"],
                "score": u["total_weight"]
            } for u in by_weight
        ],
        "by_biggest": [
            {
                "display_name": u["display_name"],
                "username": u["username"],
                "score": u["biggest_fish"]["weight"],
                "fish_name": u["biggest_fish"]["name"],
                "rarity": u["biggest_fish"]["rarity"],
                "color": FISH_LOOT_TABLE[u["biggest_fish"]["rarity"]]["color"]
            } for u in by_biggest
        ],
        "history": db["session"].get("history", []) if type == "session" else []
    }

class TestCatchModel(BaseModel):
    username: str
    display_name: str

@app.post("/api/test-catch")
async def post_test_catch(payload: TestCatchModel):
    fish = choose_catch()
    user_stats = register_catch(payload.username, payload.display_name, fish)
    
    event_data = {
        "type": "catch",
        "user": {
            "username": payload.username,
            "display_name": payload.display_name
        },
        "fish": fish,
        "stats": {
            "total_fish": user_stats["total_fish"],
            "total_weight": user_stats["total_weight"],
            "biggest_fish_weight": user_stats["biggest_fish"]["weight"] if user_stats["biggest_fish"] else 0.0,
            "biggest_fish_name": user_stats["biggest_fish"]["name"] if user_stats["biggest_fish"] else ""
        }
    }
    await broadcast_message(event_data)
    return {"status": "ok", "event": event_data}

@app.post("/api/reset-database")
def post_reset_database():
    db = load_database()
    db["session"] = {"users": {}, "history": []}
    save_database(db)
    return {"status": "ok"}

# Twitch OAuth endpoints
@app.get("/auth/twitch")
def auth_twitch():
    config = load_config()
    client_id = config.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Client ID не указан в настройках.")
        
    redirect_uri = "http://localhost:3000/auth/callback"
    scopes = [
        "channel:read:redemptions",
        "channel:manage:redemptions",
        "moderator:manage:banned_users"
    ]
    scope_str = "%20".join(scopes)
    auth_url = (
        f"https://id.twitch.tv/oauth2/authorize"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope={scope_str}"
    )
    return RedirectResponse(auth_url)

@app.get("/auth/callback")
def auth_callback(code: str = None, error: str = None):
    if error:
        return RedirectResponse(f"/?error={error}")
    if not code:
        raise HTTPException(status_code=400, detail="Код авторизации отсутствует.")
        
    config = load_config()
    client_id = config.get("client_id")
    client_secret = config.get("client_secret")
    redirect_uri = "http://localhost:3000/auth/callback"
    
    # Exchange code for access token
    token_url = "https://id.twitch.tv/oauth2/token"
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri
    }
    
    try:
        response = requests.post(token_url, data=payload)
        if response.status_code != 200:
            logger.error(f"Token exchange failed: {response.text}")
            return RedirectResponse("/?error=token_exchange_failed")
            
        token_data = response.json()
        config["access_token"] = token_data["access_token"]
        config["refresh_token"] = token_data["refresh_token"]
        save_config(config)
        
        # Get broadcaster details
        user_url = "https://api.twitch.tv/helix/users"
        user_headers = {
            "Client-ID": client_id,
            "Authorization": f"Bearer {token_data['access_token']}"
        }
        user_res = requests.get(user_url, headers=user_headers)
        if user_res.status_code == 200:
            user_data = user_res.json()["data"][0]
            config["broadcaster_id"] = user_data["id"]
            config["broadcaster_name"] = user_data["display_name"]
            save_config(config)
            logger.info(f"Connected Twitch streamer: {user_data['display_name']} (ID: {user_data['id']})")
        else:
            logger.error(f"Failed to fetch user data: {user_res.text}")
            return RedirectResponse("/?error=fetch_user_failed")
            
        return RedirectResponse("/?success=connected")
    except Exception as e:
        logger.error(f"Error in OAuth callback: {e}")
        return RedirectResponse("/?error=exception_occurred")

# WebSockets endpoint for frontend widgets and OBS
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"New client connected. Active: {len(active_connections)}")
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        logger.info(f"Client disconnected. Active: {len(active_connections)}")

@app.on_event("startup")
async def startup_event():
    # Auto-start listener if marked active
    config = load_config()
    if config.get("is_active"):
        logger.info("Twitch Fishing starting up as ACTIVE. Starting EventSub...")
        await start_eventsub()

# Serve static dashboard and widgets
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=3000, reload=True)
