import boto3
import os
from datetime import datetime, timedelta

def event_notifier(event, context):
    """
    Scans a DynamoDB table for food items that are expiring soon and sends
    a notification for each item via Amazon SNS.
    """
    # --- Configuration from Environment Variables ---
    try:
        DYNAMODB_TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
        SNS_TOPIC_ARN = os.environ['SNS_TOPIC_ARN']
        DAYS_UNTIL_EXPIRATION = int(os.environ.get('DAYS_UNTIL_EXPIRATION', 3))
    except KeyError as e:
        print(f"Error: Environment variable {e} not set.")
        raise

    # --- AWS Service Clients ---
    dynamodb = boto3.resource('dynamodb')
    sns = boto3.client('sns')
    table = dynamodb.Table(DYNAMODB_TABLE_NAME)

    # --- Date Threshold Calculation ---
    # Calculate the date range for expiring items
    today_str = datetime.utcnow().strftime('%Y-%m-%d')
    expiration_threshold_str = (datetime.utcnow() + timedelta(days=DAYS_UNTIL_EXPIRATION)).strftime('%Y-%m-%d')

    print(f"Scanning for items expiring between {today_str} and {expiration_threshold_str}")

    # --- DynamoDB Scan ---
    try:
        response = table.scan(
            FilterExpression='begins_with(sk, :item_prefix) AND expiration_date BETWEEN :today AND :threshold',
            ExpressionAttributeValues={
                ':item_prefix': 'ITEM#',
                ':today': today_str,
                ':threshold': expiration_threshold_str
            }
        )
        items = response.get('Items', [])
        
        print(f"Found {len(items)} items expiring soon.")

        # --- Process and Notify ---
        for item in items:
            try:
                user_email = item['pk'].split('#')[1]
                message = (
                    f"Hello {user_email},\n\n"
                    f"This is a friendly reminder that your food item '{item['itemName']}' is expiring soon.\n"
                    f"Expiration Date: {item['expiryDate']}\n\n"
                    "Please consider using it or donating it to a local food bank to prevent waste.\n\n"
                    "Thank you,\nFood Waste Management Team"
                )
                
                # Publish to SNS
                sns.publish(
                    TopicArn=SNS_TOPIC_ARN,
                    Message=message,
                    Subject=f"Your Food Item '{item['itemName']}' is Expiring Soon!"
                )
                print(f"Sent notification for item '{item['itemName']}' to user '{user_email}'.")
            except Exception as e:
                print(f"Error processing item {item.get('sk', 'Unknown')}: {str(e)}")

        return {
            'statusCode': 200,
            'body': f"Successfully processed {len(items)} expiring items."
        }

    except Exception as e:
        print(f"An error occurred during DynamoDB scan: {str(e)}")
        return {
            'statusCode': 500,
            'body': f"Error processing items: {str(e)}"
        } 