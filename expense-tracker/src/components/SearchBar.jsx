function SearchBar({ searchTerm, setSearchTerm }) {
  return (
    <div className="mb-4">
      <input
        type="text"
        placeholder="Search expenses..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
    </div>
  );
}

export default SearchBar;