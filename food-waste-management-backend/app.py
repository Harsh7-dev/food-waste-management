import os
import boto3
import jwt
import datetime
import bcrypt
import uuid
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# --- Configuration ---
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-default-secret-key')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME')
AWS_REGION = os.environ.get('AWS_REGION')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN')

# --- AWS Service Clients ---
# Use try-except blocks to handle potential initialization errors if config is missing
try:
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(DYNAMODB_TABLE_NAME)
except Exception as e:
    print(f"Error initializing DynamoDB: {e}")
    dynamodb = None
    table = None

try:
    sns_client = boto3.client('sns', region_name=AWS_REGION)
except Exception as e:
    print(f"Error initializing SNS: {e}")
    sns_client = None

# --- Helper Functions ---
def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

def check_password(password, hashed_password):
    # hashed_password should be bytes
    return bcrypt.checkpw(password.encode('utf-8'), hashed_password)

def generate_token(email):
    payload = {
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24),
        'iat': datetime.datetime.utcnow(),
        'sub': email
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def token_required(f):
    def decorator(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        if auth_header:
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Bearer token malformed!'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing!'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['sub']
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError) as e:
            return jsonify({'message': f'Token is invalid or expired! {e}'}), 401

        return f(current_user_email, *args, **kwargs)
    decorator.__name__ = f.__name__
    return decorator

# --- Validation Functions ---
def validate_email(email):
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Validate password strength"""
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"
    return True, "Password is valid"

def sanitize_input(text):
    """Basic input sanitization"""
    if not text:
        return text
    return text.strip()

def validate_item_data(data):
    """Validate food item data"""
    errors = []
    
    item_name = sanitize_input(data.get('itemName', ''))
    if not item_name or len(item_name) < 2:
        errors.append("Item name must be at least 2 characters long")
    
    quantity = data.get('quantity')
    if not quantity or not isinstance(quantity, (int, str)) or int(quantity) <= 0:
        errors.append("Quantity must be a positive number")
    
    try:
        purchase_date = datetime.datetime.strptime(data.get('purchaseDate', ''), '%Y-%m-%d')
        expiry_date = datetime.datetime.strptime(data.get('expiryDate', ''), '%Y-%m-%d')
        
        if expiry_date <= purchase_date:
            errors.append("Expiry date must be after purchase date")
        
        if expiry_date < datetime.datetime.now():
            errors.append("Expiry date cannot be in the past")
            
    except ValueError:
        errors.append("Invalid date format. Use YYYY-MM-DD")
    
    return errors

# --- Routes ---
@app.route('/register', methods=['POST'])
def register():
    if not table:
        return jsonify({'message': 'Database not configured'}), 503

    data = request.get_json()
    email = sanitize_input(data.get('email', ''))
    password = data.get('password')

    # Validate email
    if not email or not validate_email(email):
        return jsonify({'message': 'Please provide a valid email address'}), 400

    # Validate password
    if not password:
        return jsonify({'message': 'Password is required'}), 400
    
    is_valid, password_message = validate_password(password)
    if not is_valid:
        return jsonify({'message': password_message}), 400

    try:
        hashed_password = hash_password(password)
        table.put_item(
            Item={
                'pk': f"USER#{email}",
                'sk': 'PROFILE',
                'email': email,
                'password': hashed_password.decode('utf-8'), # Store as string
                'createdAt': datetime.datetime.utcnow().isoformat()
            },
            ConditionExpression='attribute_not_exists(pk)'
        )

        if SNS_TOPIC_ARN and sns_client:
            try:
                sns_client.subscribe(
                    TopicArn=SNS_TOPIC_ARN,
                    Protocol='email',
                    Endpoint=email
                )
                print(f"Successfully initiated subscription for {email}.")
            except ClientError as e:
                print(f"Error subscribing {email} to SNS topic: {e}")

        return jsonify({'message': 'User registered successfully. Please check your email to confirm notification subscription.'}), 201

    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return jsonify({'message': 'User already exists'}), 409
        print(f"DynamoDB Error on register: {e}")
        return jsonify({'message': 'Could not register user due to a database error'}), 500

@app.route('/login', methods=['POST'])
def login():
    if not table:
        return jsonify({'message': 'Database not configured'}), 503
        
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400

    try:
        response = table.get_item(
            Key={'pk': f"USER#{email}", 'sk': 'PROFILE'}
        )
        user = response.get('Item')

        if not user:
            return jsonify({'message': 'User not found'}), 404

        # Convert stored password string back to bytes for checking
        stored_password_hash = user.get('password').encode('utf-8')
        if check_password(password, stored_password_hash):
            token = generate_token(email)
            return jsonify({'token': token}), 200
        else:
            return jsonify({'message': 'Invalid credentials'}), 401

    except ClientError as e:
        print(f"DynamoDB Error on login: {e}")
        return jsonify({'message': 'Could not process login request'}), 500

@app.route('/items', methods=['POST'])
@token_required
def add_item(current_user_email):
    if not table:
        return jsonify({'message': 'Database not configured'}), 503

    data = request.get_json()
    
    # Validate item data
    validation_errors = validate_item_data(data)
    if validation_errors:
        return jsonify({'message': 'Validation failed', 'errors': validation_errors}), 400
    
    item_id = str(uuid.uuid4())
    
    item = {
        'pk': f"USER#{current_user_email}",
        'sk': f"ITEM#{item_id}",
        'itemId': item_id,
        'itemName': sanitize_input(data.get('itemName')),
        'quantity': int(data.get('quantity')),
        'purchaseDate': data.get('purchaseDate'),
        'expiryDate': data.get('expiryDate'),
        'createdAt': datetime.datetime.utcnow().isoformat()
    }

    try:
        table.put_item(Item=item)
        return jsonify({'message': 'Item added successfully', 'item': item}), 201
    except ClientError as e:
        print(f"DynamoDB Error on add_item: {e}")
        return jsonify({'message': 'Could not add item'}), 500

@app.route('/items', methods=['GET'])
@token_required
def get_items(current_user_email):
    if not table:
        return jsonify({'message': 'Database not configured'}), 503
        
    try:
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('pk').eq(f'USER#{current_user_email}') & boto3.dynamodb.conditions.Key('sk').begins_with('ITEM#')
        )
        items = response.get('Items', [])
        return jsonify(items), 200
    except ClientError as e:
        print(f"DynamoDB Error on get_items: {e}")
        return jsonify({'message': 'Could not retrieve items'}), 500

@app.route('/items/<item_id>', methods=['DELETE'])
@token_required
def delete_item(current_user_email, item_id):
    if not table:
        return jsonify({'message': 'Database not configured'}), 503

    try:
        table.delete_item(
            Key={
                'pk': f"USER#{current_user_email}",
                'sk': f"ITEM#{item_id}"
            }
        )
        return jsonify({'message': 'Item deleted successfully'}), 200
    except ClientError as e:
        print(f"DynamoDB Error on delete_item: {e}")
        return jsonify({'message': 'Could not delete item'}), 500

@app.route('/items/<item_id>', methods=['PUT'])
@token_required
def update_item(current_user_email, item_id):
    if not table:
        return jsonify({'message': 'Database not configured'}), 503

    data = request.get_json()
    
    # Validate item data
    validation_errors = validate_item_data(data)
    if validation_errors:
        return jsonify({'message': 'Validation failed', 'errors': validation_errors}), 400

    try:
        # Check if item exists and belongs to user
        response = table.get_item(
            Key={
                'pk': f"USER#{current_user_email}",
                'sk': f"ITEM#{item_id}"
            }
        )
        
        if 'Item' not in response:
            return jsonify({'message': 'Item not found'}), 404

        # Update item
        table.update_item(
            Key={
                'pk': f"USER#{current_user_email}",
                'sk': f"ITEM#{item_id}"
            },
            UpdateExpression='SET itemName = :name, quantity = :qty, purchaseDate = :purchase, expiryDate = :expiry, updatedAt = :updated',
            ExpressionAttributeValues={
                ':name': sanitize_input(data.get('itemName')),
                ':qty': int(data.get('quantity')),
                ':purchase': data.get('purchaseDate'),
                ':expiry': data.get('expiryDate'),
                ':updated': datetime.datetime.utcnow().isoformat()
            }
        )
        
        return jsonify({'message': 'Item updated successfully'}), 200
    except ClientError as e:
        print(f"DynamoDB Error on update_item: {e}")
        return jsonify({'message': 'Could not update item'}), 500

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy'}), 200

@app.route('/analytics', methods=['GET'])
@token_required
def get_analytics(current_user_email):
    if not table:
        return jsonify({'message': 'Database not configured'}), 503
        
    try:
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('pk').eq(f'USER#{current_user_email}') & boto3.dynamodb.conditions.Key('sk').begins_with('ITEM#')
        )
        items = response.get('Items', [])
        
        # Calculate analytics
        total_items = len(items)
        expired_items = 0
        expiring_soon = 0
        total_quantity = 0
        
        today = datetime.datetime.now().date()
        three_days_from_now = today + datetime.timedelta(days=3)
        
        for item in items:
            expiry_date = datetime.datetime.strptime(item['expiryDate'], '%Y-%m-%d').date()
            quantity = int(item.get('quantity', 0))
            total_quantity += quantity
            
            if expiry_date < today:
                expired_items += 1
            elif expiry_date <= three_days_from_now:
                expiring_soon += 1
        
        analytics = {
            'totalItems': total_items,
            'totalQuantity': total_quantity,
            'expiredItems': expired_items,
            'expiringSoon': expiring_soon,
            'wastePercentage': round((expired_items / total_items * 100) if total_items > 0 else 0, 2),
            'averageQuantity': round(total_quantity / total_items, 2) if total_items > 0 else 0
        }
        
        return jsonify(analytics), 200
    except ClientError as e:
        print(f"DynamoDB Error on get_analytics: {e}")
        return jsonify({'message': 'Could not retrieve analytics'}), 500

if __name__ == '__main__':
    # This block is for local development only
    # Zappa will use the 'app' object directly
    app.run(debug=True, port=5000) 