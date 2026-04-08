// this stores all my shopping items
let myItems = [];

// this runs when i click the add button
document.getElementById("form").addEventListener("submit", function(e) {
    e.preventDefault();

    // get what the user typed
    let name = document.getElementById("item-input").value;
    let quantity = document.getElementById("quantity-input").value;
    let price = document.getElementById("category-input").value;

    // dont add if fields are empty
    if (name == "" || quantity == "" || price == "") {
        alert("Please fill in all fields");
        return;
    }

    // create a new item and add it to the list
    let newItem = {
        name: name,
        quantity: quantity,
        price: price,
        purchased: false
    };

    myItems.push(newItem);
    showItems();
    e.target.reset();
});

// this shows all items on the page
function showItems() {
    let list = document.getElementById("shopping-list");
    let total = 0;
    list.innerHTML = "";

    for (let i = 0; i < myItems.length; i++) {
        let item = myItems[i];

        // create a list item
        let li = document.createElement("li");
        li.innerHTML = item.name + " (x" + item.quantity + ") - ksh" + item.price +
            ' <button onclick="removeItem(' + i + ')">Remove</button>' +
            ' <button onclick="markDone(' + i + ')">Done</button>';

        // if item is done change its look
        if (item.purchased == true) {
            li.style.textDecoration = "line-through";
            total = total + (item.price * item.quantity);
        }

        list.appendChild(li);
    }

    // show total
    document.getElementById("total").textContent = total;
}

// this removes an item
function removeItem(i) {
    myItems.splice(i, 1);
    showItems();
}

// this marks item as done
function markDone(i) {
    myItems[i].purchased = true;
    showItems();
}

// this clears everything
document.getElementById("clear-button").addEventListener("click", function() {
    myItems = [];
    showItems();
});
