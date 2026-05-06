function ExpenseTable({ expenses, deleteExpense }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {expenses.map((expense) => (
          <tr key={expense.id} className="hover:bg-gray-50">
            <td className="px-6 py-4 text-sm text-gray-800">{expense.name}</td>
            <td className="px-6 py-4 text-sm text-gray-800">{expense.category}</td>
            <td className="px-6 py-4 text-sm text-gray-800">${expense.amount}</td>
            <td className="px-6 py-4 text-sm text-gray-800">{expense.description}</td>
            <td className="px-6 py-4 text-sm text-gray-800">{expense.date}</td>
            <td className="px-6 py-4"><button onClick={() => deleteExpense(expense.id)} className="text-red-500 hover:text-red-700 text-sm font-medium">Delete</button></td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export default ExpenseTable;